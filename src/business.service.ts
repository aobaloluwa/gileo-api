import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import {
  ContentStatus, EntitlementType, OrderStatus, PaymentStatus, Prisma, PurchaseType,
  ServiceRequestStatus, SupportStatus, UserRole,
} from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import {
  AssignProviderDto, AssignSupportTicketDto, CareOnboardingDto, CreateAnnouncementDto, CreateCategoryDto, CreateCohortDto, CreateCommunityResourceDto, CreateEbookDto, CreateOrderDto, CreateSupportMessageDto,
  CreateProductDto, CreateServiceDto, CreateServiceRequestDto,
  CreateSupportTicketDto, CreateVariantDto, GILEO_USER_PERMISSIONS, InitializePaymentDto, SetUserPermissionsDto, UpdateCohortDto, UpdateEbookDto, UpdateProductDto, UpdateServiceDto, UpdateStatusDto, UpdateUserRoleDto,
} from './business.dto';

const publicServiceStatus = ContentStatus.PUBLISHED;
const paystackBase = 'https://api.paystack.co';

@Injectable()
export class BusinessService {
  private expiryTimer?: ReturnType<typeof setInterval>;
  onModuleInit() { this.expiryTimer = setInterval(() => { void this.releaseExpiredOrders().catch(() => undefined); }, 60_000); this.expiryTimer.unref?.(); }
  onModuleDestroy() { if (this.expiryTimer) clearInterval(this.expiryTimer); }
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async requireUser(userId?: string) {
    if (!userId) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true, role: true } });
    if (!user) throw new UnauthorizedException();
    return user;
  }
  private async requirePermission(userId: string | undefined, permission: string) {
    const user = await this.requireUser(userId);
    if (user.role === UserRole.ADMIN) return user;
    if (!(GILEO_USER_PERMISSIONS as readonly string[]).includes(permission)) throw new ForbiddenException('Unknown permission.');
    const grant = await this.prisma.userPermission.findUnique({ where: { userId_permission: { userId: user.id, permission } }, select: { id: true } });
    if (!grant) throw new ForbiddenException(`The ${permission} permission is required.`);
    return user;
  }
  private ebookStorageRoot() { return resolve(this.config.get<string>('EBOOK_STORAGE_DIR') || join(process.cwd(), 'private-ebooks')); }
  private async releaseExpiredOrders() {
    const now = new Date();
    const expired = await this.prisma.order.findMany({ where: { status: OrderStatus.PENDING_PAYMENT, stockReleasedAt: null, reservationExpiresAt: { lte: now } }, select: { id: true } });
    for (const item of expired) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.order.updateMany({ where: { id: item.id, status: OrderStatus.PENDING_PAYMENT, stockReleasedAt: null, reservationExpiresAt: { lte: now } }, data: { status: OrderStatus.CANCELLED, stockReleasedAt: now } });
        if (!changed.count) return;
        const lines = await tx.orderItem.findMany({ where: { orderId: item.id } });
        for (const line of lines) {
          if (line.variantId) await tx.productVariant.update({ where: { id: line.variantId }, data: { stock: { increment: line.quantity }, isAvailable: true } });
          else await tx.product.update({ where: { id: line.productId }, data: { stock: { increment: line.quantity } } });
        }
        await tx.payment.updateMany({ where: { orderId: item.id, status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] } }, data: { status: PaymentStatus.CANCELLED, activeKey: null } });
      });
    }
    const staleCohortPayments = await this.prisma.payment.findMany({
      where: { cohortId: { not: null }, status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] }, createdAt: { lte: new Date(now.getTime() - 30 * 60 * 1000) } },
      select: { id: true, cohortId: true, cohortSeatReserved: true },
    });
    for (const payment of staleCohortPayments) {
      await this.prisma.$transaction(async tx => {
        const closed = await tx.payment.updateMany({ where: { id: payment.id, status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] } }, data: { status: PaymentStatus.CANCELLED, activeKey: null, cohortSeatReserved: false } });
        if (closed.count && payment.cohortId && payment.cohortSeatReserved) await tx.elevateCohort.updateMany({ where: { id: payment.cohortId, reservedCount: { gt: 0 } }, data: { reservedCount: { decrement: 1 } } });
      });
    }
  }
  private async requireAdmin(userId?: string) {
    const user = await this.requireUser(userId);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('Administrator access required.');
    return user;
  }
  private ref(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`; }

  async myProfile(userId: string) {
    const user = await this.requireUser(userId);
    return { ...user, phoneNumber: (await this.prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true } }))?.phoneNumber };
  }
  async updateMyProfile(userId: string, dto: { displayName?: string; phoneNumber?: string }) {
    await this.requireUser(userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
        ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber.trim() } : {}),
      },
      select: { id: true, email: true, phoneNumber: true, displayName: true, role: true },
    });
    return updated;
  }
  async listUsers(adminId: string, search?: string) {
    await this.requireAdmin(adminId);
    const q = search?.trim();
    return this.prisma.user.findMany({ where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { phoneNumber: { contains: q } }] } : undefined, select: { id: true, email: true, phoneNumber: true, displayName: true, role: true, emailVerifiedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async getUserPermissions(adminId: string, userId: string) {
    await this.requireAdmin(adminId);
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new NotFoundException('User not found.');
    return this.prisma.userPermission.findMany({ where: { userId }, orderBy: { permission: 'asc' }, select: { permission: true, grantedBy: true, createdAt: true } });
  }
  async setUserPermissions(adminId: string, userId: string, dto: SetUserPermissionsDto) {
    await this.requireAdmin(adminId);
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new NotFoundException('User not found.');
    const invalid = dto.permissions.filter(permission => !(GILEO_USER_PERMISSIONS as readonly string[]).includes(permission));
    if (invalid.length) throw new BadRequestException(`Unsupported permissions: ${invalid.join(', ')}`);
    await this.prisma.$transaction(async tx => {
      await tx.userPermission.deleteMany({ where: { userId } });
      if (dto.permissions.length) await tx.userPermission.createMany({ data: dto.permissions.map(permission => ({ userId, permission, grantedBy: adminId })) });
    });
    return this.getUserPermissions(adminId, userId);
  }
  async updateUserRole(adminId: string, userId: string, dto: UpdateUserRoleDto) {
    await this.requireAdmin(adminId);
    if (adminId === userId && dto.role !== UserRole.ADMIN) throw new BadRequestException('You cannot remove your own administrator role.');
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!current) throw new NotFoundException('User not found.');
    if (current.role === UserRole.ADMIN && dto.role !== UserRole.ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: UserRole.ADMIN } });
      if (admins <= 1) throw new BadRequestException('GILEO must retain at least one administrator.');
    }
    const user = current;
    if (!user) throw new NotFoundException('User not found.');
    return this.prisma.user.update({ where: { id: userId }, data: { role: dto.role as UserRole }, select: { id: true, email: true, displayName: true, role: true, createdAt: true } });
  }
  async seedDemoServicesIfNeeded() {
    try {
      const count = await this.prisma.service.count();
      if (count === 0) {
        await this.prisma.service.createMany({
          skipDuplicates: true,
          data: [
            {
              title: 'Home-Service Wound Dressing & Clinical Nursing',
              slug: 'home-service-wound-dressing',
              description: 'Professional clinical wound care, sterile dressing, suture removal, and post-procedure management delivered at your home by a registered nurse.',
              audience: 'Patients recovering from surgery, chronic wound management, or post-hospital discharge.',
              whatIsIncluded: 'Sterile wound dressing change, clinical assessment, vitals check, physician notes coordination, and care instructions.',
              priceKobo: 2000000,
              priceLabel: '₦20,000 / session • Indicative Demo Pricing',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              title: 'Elderly Care & Post-Hospital Recovery',
              slug: 'elderly-care-post-hospital-recovery',
              description: 'Dedicated nursing assistance, vitals monitoring, medication support, mobility aid, and recovery companionship for seniors and recovering patients.',
              audience: 'Seniors, elderly family members, or individuals recovering from major medical procedures.',
              whatIsIncluded: 'Personalized care plan, daily vitals tracking, medication administration support, mobility assistance, and family updates.',
              priceKobo: 3500000,
              priceLabel: 'Custom Care Estimate • Contact Support',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              title: 'Event Medical Coverage & First Aid Standby',
              slug: 'event-medical-coverage',
              description: 'On-site standby nurses, emergency response, and equipped first-aid coverage for public gatherings, sports events, and corporate functions.',
              audience: 'Event organizers, corporate event planners, and venue managers.',
              whatIsIncluded: 'On-site registered nurses, emergency response kit, triage station setup, ambulance coordination, and incident reporting.',
              priceKobo: 5000000,
              priceLabel: 'Custom Event Quote • Contact Support',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              title: 'On-Set & Production Medical Coverage',
              slug: 'onset-film-production-medical',
              description: 'Dedicated on-set medical personnel and safety compliance for film sets, TV productions, commercials, and high-activity creative projects.',
              audience: 'Film directors, production managers, crew leads, and media agencies.',
              whatIsIncluded: 'Continuous set standby, cast/crew safety triage, emergency first response, heat/exhaustion monitoring, and health compliance.',
              priceKobo: 6000000,
              priceLabel: 'Custom Production Quote • Contact Support',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              title: 'Community Health Outreaches & Screenings',
              slug: 'community-health-outreaches',
              description: 'Structured community health screenings, medical outreaches, blood pressure/glucose testing, and wellness education tailored for groups.',
              audience: 'NGOs, religious bodies, community leaders, and philanthropic organizations.',
              whatIsIncluded: 'Mobile clinical team, health screening tools, vitals assessment, health education talks, and referral guidance.',
              priceKobo: 7500000,
              priceLabel: 'Custom Outreach Estimate • Contact Support',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              title: 'Corporate & Organisational Medical Services',
              slug: 'corporate-organisational-medical',
              description: 'On-site corporate wellness checks, employee health screenings, occupational health support, and executive wellness programs.',
              audience: 'HR departments, corporate organizations, and business executives.',
              whatIsIncluded: 'Employee health screenings, ergonomic assessment, wellness lectures, occupational health reports, and quarterly reviews.',
              priceKobo: 10000000,
              priceLabel: 'Custom Corporate Retainer • Contact Support',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              title: 'Healthcare Service Coordination & Concierge',
              slug: 'healthcare-service-coordination',
              description: 'End-to-end medical concierge service: hospital appointment scheduling, specialist referrals, lab test home sample collection, and prescription delivery.',
              audience: 'Busy professionals, international patients, and families seeking seamless healthcare navigation.',
              whatIsIncluded: 'Dedicated nurse coordinator, priority specialist referrals, home sample collection, prescription delivery, and medical record management.',
              priceKobo: 2500000,
              priceLabel: '₦25,000 / month • Concierge Access',
              isIndicative: true,
              status: ContentStatus.PUBLISHED,
            },
          ],
        });
      }
    } catch (err) {
      console.error('Service seed failed:', err);
    }
  }

  async listServices() {
    await this.seedDemoServicesIfNeeded();
    return this.prisma.service.findMany({ where: { status: publicServiceStatus }, orderBy: { title: 'asc' } });
  }
  async createService(userId: string, dto: CreateServiceDto) {
    await this.requirePermission(userId, 'SERVICE_CATALOG_MANAGE');
    return this.prisma.service.create({ data: { ...dto, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateService(userId: string, id: string, dto: UpdateServiceDto) {
    await this.requirePermission(userId, 'SERVICE_CATALOG_MANAGE');
    if (!(await this.prisma.service.findUnique({ where: { id } }))) throw new NotFoundException('Service not found.');
    return this.prisma.service.update({ where: { id }, data: dto });
  }
  async updateServiceStatus(userId: string, id: string, dto: UpdateStatusDto) {
    await this.requirePermission(userId, 'SERVICE_REQUESTS_MANAGE');
    if (!Object.values(ServiceRequestStatus).includes(dto.status as ServiceRequestStatus)) throw new BadRequestException('Invalid service request status.');
    const request = await this.prisma.serviceRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Service request not found.');
    const status = dto.status as ServiceRequestStatus;
    if (status === ServiceRequestStatus.PAID || status === ServiceRequestStatus.ONBOARDING_REQUIRED || status === ServiceRequestStatus.ASSIGNED) throw new BadRequestException('Payment, onboarding and provider assignment statuses are controlled by their dedicated workflows.');
    const allowed: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
      SUBMITTED: [ServiceRequestStatus.UNDER_REVIEW, ServiceRequestStatus.DECLINED, ServiceRequestStatus.CANCELLED],
      UNDER_REVIEW: [ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.DECLINED, ServiceRequestStatus.CANCELLED],
      ACCEPTED: [ServiceRequestStatus.DECLINED, ServiceRequestStatus.CANCELLED],
      DECLINED: [], AWAITING_PAYMENT: [], PAID: [], ONBOARDING_REQUIRED: [],
      ASSIGNED: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.CANCELLED],
      IN_PROGRESS: [ServiceRequestStatus.COMPLETED, ServiceRequestStatus.CANCELLED],
      COMPLETED: [], CANCELLED: [],
    };
    if (!(allowed[request.status] ?? []).includes(status)) throw new BadRequestException(`Invalid service request transition: ${request.status} -> ${status}.`);
    const availabilityConfirmed = status === ServiceRequestStatus.ACCEPTED ? true : request.availabilityConfirmed;
    return this.prisma.serviceRequest.update({ where: { id }, data: { status, availabilityConfirmed, ...(dto.note !== undefined ? { adminNote: dto.note } : {}) } });
  }
  async createServiceRequest(userId: string, dto: CreateServiceRequestDto) {
    const user = await this.requireUser(userId);
    const service = await this.prisma.service.findFirst({ where: { id: dto.serviceId, status: ContentStatus.PUBLISHED } });
    if (!service) throw new NotFoundException('Service is not available.');
    return this.prisma.serviceRequest.create({
      data: {
        reference: this.ref('SR'), userId: user.id, serviceId: service.id,
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : undefined,
        location: dto.location, customerNote: dto.customerNote,
        amountKobo: service.priceKobo ?? undefined,
      },
      include: { service: true },
    });
  }
  async listMyServiceRequests(userId: string) {
    await this.requireUser(userId);
    return this.prisma.serviceRequest.findMany({ where: { userId }, include: { service: true, assignedProvider: { select: { id: true, displayName: true } }, payments: { select: { reference: true, status: true, amountKobo: true, currency: true } } }, orderBy: { createdAt: 'desc' } });
  }
  async listAllServiceRequests(userId: string) {
    await this.requirePermission(userId, 'SERVICE_REQUESTS_READ');
    return this.prisma.serviceRequest.findMany({ include: { service: true, user: { select: { id: true, email: true, displayName: true, phoneNumber: true } } }, orderBy: { createdAt: 'desc' } });
  }
  async listAssignedServiceRequests(userId: string) {
    await this.requireUser(userId);
    return this.prisma.serviceRequest.findMany({ where: { assignedProviderId: userId }, include: { service: true, user: { select: { id: true, displayName: true, phoneNumber: true } } }, orderBy: { updatedAt: 'desc' } });
  }
  async updateAssignedServiceStatus(userId: string, requestId: string, dto: UpdateStatusDto) {
    await this.requireUser(userId);
    const request = await this.prisma.serviceRequest.findFirst({ where: { id: requestId, assignedProviderId: userId } });
    if (!request) throw new NotFoundException('Assigned service request not found.');
    const next = dto.status as ServiceRequestStatus;
    const allowed: Partial<Record<ServiceRequestStatus, ServiceRequestStatus[]>> = {
      ASSIGNED: [ServiceRequestStatus.IN_PROGRESS],
      IN_PROGRESS: [ServiceRequestStatus.COMPLETED],
    };
    if (!(allowed[request.status] ?? []).includes(next)) throw new BadRequestException('Assigned providers may only move their own requests from ASSIGNED to IN_PROGRESS, or IN_PROGRESS to COMPLETED.');
    const changed = await this.prisma.serviceRequest.updateMany({ where: { id: requestId, assignedProviderId: userId, status: request.status }, data: { status: next } });
    if (changed.count !== 1) throw new BadRequestException('Request status changed; reload and try again.');
    return this.prisma.serviceRequest.findUnique({ where: { id: requestId }, include: { service: true, assignedProvider: { select: { id: true, displayName: true } } } });
  }

  async createCareOnboarding(userId: string, dto: CareOnboardingDto) {
    await this.requireUser(userId);
    if (!dto.consentToCareData) throw new BadRequestException('Consent is required before submitting care onboarding information.');
    const request = await this.prisma.serviceRequest.findFirst({ where: { id: dto.serviceRequestId, userId }, include: { payments: true } });
    if (!request) throw new NotFoundException('Service request not found.');
    if (request.status !== ServiceRequestStatus.PAID && request.status !== ServiceRequestStatus.ONBOARDING_REQUIRED) {
      throw new BadRequestException('Care onboarding is available only after GILEO confirms the service and payment is verified.');
    }
    if (!request.payments.some(payment => payment.status === PaymentStatus.VERIFIED)) throw new BadRequestException('Verified payment is required before submitting care onboarding information.');
    const onboarding = await this.prisma.careOnboarding.upsert({
      where: { serviceRequestId: request.id },
      create: { ...dto, userId, serviceRequestId: request.id },
      update: { patientName: dto.patientName, contactPhone: dto.contactPhone, emergencyContactName: dto.emergencyContactName, emergencyContactPhone: dto.emergencyContactPhone, careNotes: dto.careNotes, consentToCareData: true },
    });
    await this.prisma.serviceRequest.update({ where: { id: request.id }, data: { status: ServiceRequestStatus.ONBOARDING_REQUIRED } });
    return { message: 'Care onboarding submitted securely.', onboarding: { id: onboarding.id, serviceRequestId: onboarding.serviceRequestId, createdAt: onboarding.createdAt } };
  }
  async getCareOnboarding(userId: string, requestId: string) {
    const user = await this.requireUser(userId);
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId }, select: { id: true, userId: true, assignedProviderId: true } });
    if (!request) throw new NotFoundException('Service request not found.');
    const allowed = user.role === UserRole.ADMIN || request.assignedProviderId === userId;
    if (!allowed) throw new ForbiddenException('Care information is restricted to the assigned provider and authorised administrators.');
    return this.prisma.careOnboarding.findUnique({ where: { serviceRequestId: requestId } });
  }
  async assignProvider(adminId: string, requestId: string, dto: AssignProviderDto) {
    await this.requirePermission(adminId, 'SERVICE_PROVIDER_ASSIGN');
    const provider = await this.prisma.user.findUnique({ where: { id: dto.providerId }, select: { id: true, role: true } });
    if (!provider || provider.role === UserRole.ADMIN) throw new BadRequestException('Select an existing non-administrator user as the care provider. Provider eligibility must be verified operationally before assignment.');
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId }, include: { payments: true, onboarding: true } });
    if (!request) throw new NotFoundException('Service request not found.');
    if (!request.payments.some(payment => payment.status === PaymentStatus.VERIFIED)) throw new BadRequestException('A provider can only be assigned after payment verification.');
    if (!request.onboarding) throw new BadRequestException('Care onboarding must be completed before provider assignment.');
    return this.prisma.serviceRequest.update({ where: { id: requestId }, data: { assignedProviderId: provider.id, status: ServiceRequestStatus.ASSIGNED }, include: { assignedProvider: { select: { id: true, displayName: true } }, service: true } });
  }
  async listCategories() { return this.prisma.productCategory.findMany({ orderBy: { name: 'asc' } }); }
  async createCategory(userId: string, dto: CreateCategoryDto) {
    await this.requirePermission(userId, 'INVENTORY_MANAGE');
    return this.prisma.productCategory.create({ data: dto });
  }
  async seedDemoProductsIfNeeded() {
    try {
      let category = await this.prisma.productCategory.findFirst({ where: { slug: 'gileo-scrubs' } });
      if (!category) {
        category = await this.prisma.productCategory.create({
          data: {
            name: 'Gileo Scrubs',
            slug: 'gileo-scrubs',
            description: 'Authentic Gileo Scrubs Collection',
          },
        });
      }

      const count = await this.prisma.product.count({ where: { status: ContentStatus.PUBLISHED } });
      if (count === 0) {
        await this.prisma.product.createMany({
          skipDuplicates: true,
          data: [
            {
              id: '9b1deb4d-3b7d-4149-9cd1-e633d3170001',
              categoryId: category.id,
              slug: 'gileo-dri-fit-scrubs-set',
              title: 'Gileo Dri-FIT Premium Scrubs Set',
              description: 'Engineered with fluid-resistant, 4-way stretch fabric designed to help healthcare professionals stay comfortable during demanding shifts.',
              priceKobo: 2850000,
              stock: 100,
              status: ContentStatus.PUBLISHED,
              isDemo: true,
              images: [],
            },
            {
              id: '9b1deb4d-3b7d-4149-9cd1-e633d3170002',
              categoryId: category.id,
              slug: 'clinical-stethoscope-pro',
              title: 'Clinical Dual-Head Stethoscope',
              description: 'Precision acoustic sensitivity for cardiac and pulmonary assessment with soft-sealing eartips.',
              priceKobo: 3500000,
              stock: 50,
              status: ContentStatus.PUBLISHED,
              isDemo: true,
              images: [],
            },
            {
              id: '9b1deb4d-3b7d-4149-9cd1-e633d3170003',
              categoryId: category.id,
              slug: 'digital-bp-monitor',
              title: 'Digital Automatic BP Monitor',
              description: 'Clinical-grade digital blood pressure monitor with automatic pulse readout and memory logs.',
              priceKobo: 2200000,
              stock: 50,
              status: ContentStatus.PUBLISHED,
              isDemo: true,
              images: [],
            },
            {
              id: '9b1deb4d-3b7d-4149-9cd1-e633d3170004',
              categoryId: category.id,
              slug: 'nurse-carry-backpack',
              title: 'Nurse Organizer Carry Backpack',
              description: 'Waterproof multi-compartment organizer backpack designed for clinical equipment and personal essentials.',
              priceKobo: 1800000,
              stock: 50,
              status: ContentStatus.PUBLISHED,
              isDemo: true,
              images: [],
            },
          ],
        });
      }
    } catch (err) {
      console.error('Demo product seed failed:', err);
    }
  }

  async listProducts(categoryId?: string) {
    await this.seedDemoProductsIfNeeded();
    return this.prisma.product.findMany({
      where: { status: ContentStatus.PUBLISHED, ...(categoryId ? { categoryId } : {}) },
      include: { category: true, variants: { where: { isAvailable: true }, select: { id: true, name: true, size: true, colour: true, stock: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createProduct(userId: string, dto: CreateProductDto) {
    await this.requirePermission(userId, 'INVENTORY_MANAGE');
    const category = await this.prisma.productCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('Category not found.');
    return this.prisma.product.create({ data: { ...dto, images: (dto.images ?? []) as any, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateProductStock(userId: string, productId: string, stock: number) {
    await this.requirePermission(userId, 'INVENTORY_MANAGE');
    if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException('Stock must be a non-negative integer.');
    return this.prisma.product.update({ where: { id: productId }, data: { stock } });
  }
  async updateProduct(userId: string, id: string, dto: UpdateProductDto) {
    await this.requirePermission(userId, 'INVENTORY_MANAGE');
    if (!(await this.prisma.product.findUnique({ where: { id } }))) throw new NotFoundException('Product not found.');
    if (dto.categoryId && !(await this.prisma.productCategory.findUnique({ where: { id: dto.categoryId } }))) throw new NotFoundException('Category not found.');
    return this.prisma.product.update({ where: { id }, data: { ...dto, ...(dto.images ? { images: dto.images as any } : {}) } });
  }
  async createVariant(userId: string, dto: CreateVariantDto) {
    await this.requirePermission(userId, 'INVENTORY_MANAGE');
    if (!(await this.prisma.product.findUnique({ where: { id: dto.productId } }))) throw new NotFoundException('Product not found.');
    return this.prisma.productVariant.create({ data: { ...dto, stock: dto.stock ?? 0, isAvailable: (dto.stock ?? 0) > 0 } });
  }
  async updateStock(userId: string, variantId: string, stock: number) {
    await this.requirePermission(userId, 'INVENTORY_MANAGE');
    if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException('Stock must be a non-negative integer.');
    return this.prisma.productVariant.update({ where: { id: variantId }, data: { stock, isAvailable: stock > 0 } });
  }
  async createOrder(userId: string, dto: CreateOrderDto) {
    await this.requireUser(userId);
    await this.seedDemoProductsIfNeeded();
    await this.releaseExpiredOrders();
    if (!dto.items?.length || dto.items.length > 50) throw new BadRequestException('An order must contain 1–50 line items.');
    const orderId = await this.prisma.$transaction(async tx => {
      let subtotal = 0;
      const lines: Array<{ productId: string; variantId?: string; titleSnapshot: string; skuSnapshot?: string; unitPriceKobo: number; quantity: number; lineTotalKobo: number }> = [];
      for (const item of dto.items) {
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw new BadRequestException('Each quantity must be an integer between 1 and 100.');
        const product = await tx.product.findFirst({ where: { id: item.productId, status: ContentStatus.PUBLISHED } });
        if (!product) throw new BadRequestException('One or more products are unavailable.');
        let variant: { id: string; sku: string; stock: number } | null = null;
        if (item.variantId) {
          variant = await tx.productVariant.findFirst({ where: { id: item.variantId, productId: product.id, isAvailable: true } });
          if (!variant) throw new BadRequestException(`Selected variant for ${product.title} is unavailable.`);
          const updated = await tx.productVariant.updateMany({ where: { id: variant.id, stock: { gte: item.quantity }, isAvailable: true }, data: { stock: { decrement: item.quantity }, ...(item.quantity === variant.stock ? { isAvailable: false } : {}) } });
          if (updated.count !== 1) throw new BadRequestException(`Insufficient stock for ${product.title}.`);
        } else {
          const updated = await tx.product.updateMany({ where: { id: product.id, stock: { gte: item.quantity }, status: ContentStatus.PUBLISHED }, data: { stock: { decrement: item.quantity } } });
          if (updated.count !== 1) throw new BadRequestException(`Insufficient stock for ${product.title}.`);
        }
        const lineTotalKobo = product.priceKobo * item.quantity;
        subtotal += lineTotalKobo;
        lines.push({ productId: product.id, variantId: variant?.id, titleSnapshot: product.title, skuSnapshot: variant?.sku, unitPriceKobo: product.priceKobo, quantity: item.quantity, lineTotalKobo });
      }
      const order = await tx.order.create({
        data: {
          reference: this.ref('ORD'), userId, status: OrderStatus.PENDING_PAYMENT, reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
          subtotalKobo: subtotal, deliveryKobo: 0, totalKobo: subtotal,
          shippingAddress: dto.shippingAddress as any,
          items: { create: lines },
        },
      });
      return order.id;
    });
    return this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  }
  async listMyOrders(userId: string) {
    await this.requireUser(userId);
    return this.prisma.order.findMany({ where: { userId }, include: { items: true, payments: { select: { reference: true, status: true, amountKobo: true } } }, orderBy: { createdAt: 'desc' } });
  }
  async listAllOrders(userId: string) {
    await this.requirePermission(userId, 'ORDERS_READ');
    await this.releaseExpiredOrders();
    return this.prisma.order.findMany({ include: { items: true, user: { select: { id: true, email: true, displayName: true } } }, orderBy: { createdAt: 'desc' } });
  }
  async updateOrderStatus(userId: string, id: string, dto: UpdateStatusDto) {
    await this.requirePermission(userId, 'ORDERS_MANAGE');
    if (!Object.values(OrderStatus).includes(dto.status as OrderStatus)) throw new BadRequestException('Invalid order status.');
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    const nextStatus = dto.status as OrderStatus;
    if (nextStatus === OrderStatus.REFUNDED) throw new BadRequestException('Use the payment refund workflow; order status cannot independently mark a refund.');
    if (order.status === OrderStatus.PENDING_PAYMENT && nextStatus !== OrderStatus.CANCELLED) throw new BadRequestException('An unpaid order cannot move to fulfilment.');
    if (nextStatus === OrderStatus.PAID) throw new BadRequestException('Only verified payment can mark an order as paid.');
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) throw new BadRequestException('This order is already closed.');
    if (nextStatus === OrderStatus.CANCELLED) {
      if (order.status !== OrderStatus.PENDING_PAYMENT) throw new BadRequestException('Paid orders cannot be cancelled directly. Initiate a refund and reconcile it with Paystack first.');
      await this.prisma.$transaction(async tx => {
        const changed = await tx.order.updateMany({ where: { id, status: OrderStatus.PENDING_PAYMENT, stockReleasedAt: null }, data: { status: OrderStatus.CANCELLED, stockReleasedAt: new Date() } });
        if (changed.count !== 1) throw new BadRequestException('Order is already closed or its stock was released; reload and try again.');
        const items = await tx.orderItem.findMany({ where: { orderId: id } });
        for (const item of items) {
          if (item.variantId) await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity }, isAvailable: true } });
          else await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        }
        await tx.payment.updateMany({ where: { orderId: id, status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] } }, data: { status: PaymentStatus.CANCELLED, activeKey: null } });
      });
      return this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    }
    const orderTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
      PAID: [OrderStatus.PROCESSING],
      PROCESSING: [OrderStatus.FULFILMENT],
      FULFILMENT: [OrderStatus.SHIPPED],
      SHIPPED: [OrderStatus.DELIVERED],
    };
    if (!(orderTransitions[order.status] ?? []).includes(nextStatus)) throw new BadRequestException(`Invalid order transition: ${order.status} -> ${nextStatus}.`);
    return this.prisma.order.update({ where: { id }, data: { status: nextStatus } });
  }

  async listEbooks() {
    await this.seedDemoCohortsAndCommunityIfNeeded();
    return this.prisma.ebook.findMany({
      where: { status: ContentStatus.PUBLISHED },
      select: { id: true, slug: true, title: true, description: true, author: true, priceKobo: true, priceLabel: true, isIndicative: true, currency: true, coverImage: true, isDemo: true },
      orderBy: { createdAt: 'asc' },
    });
  }
  async createEbook(userId: string, dto: CreateEbookDto) {
    await this.requirePermission(userId, 'LEARNING_MANAGE');
    return this.prisma.ebook.create({ data: { ...dto, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateEbook(userId: string, id: string, dto: UpdateEbookDto) {
    await this.requirePermission(userId, 'LEARNING_MANAGE');
    if (!(await this.prisma.ebook.findUnique({ where: { id } }))) throw new NotFoundException('E-book not found.');
    return this.prisma.ebook.update({ where: { id }, data: dto });
  }
  async seedDemoCohortsAndCommunityIfNeeded() {
    try {
      const ebookCount = await this.prisma.ebook.count({ where: { status: ContentStatus.PUBLISHED } });
      if (ebookCount === 0) {
        await this.prisma.ebook.createMany({
          skipDuplicates: true,
          data: [
            {
              id: '9f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b01',
              slug: 'how-to-become-a-nurse-concierge',
              title: 'How to Become a Nurse Concierge',
              description: 'The definitive blueprint for registered nurses building a high-impact independent concierge nursing practice and private care consultancy.',
              author: 'Gileo Medicals Global Limited',
              priceKobo: 1500000,
              priceLabel: '₦15,000 • Digital E-Book Guide',
              isIndicative: false,
              coverImage: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&auto=format&fit=crop&q=80',
              fileKey: 'demo/how-to-become-a-nurse-concierge.pdf',
              isDemo: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              id: '9f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b02',
              slug: 'how-to-build-a-professional-nursing-portfolio',
              title: 'How to Build a Professional Nursing Portfolio',
              description: 'Step-by-step workbook and executive templates for structuring clinical competencies, certifications, and leadership milestones for international opportunities.',
              author: 'Gileo Medicals Global Limited',
              priceKobo: 1200000,
              priceLabel: '₦12,000 • Executive Template Guide',
              isIndicative: false,
              coverImage: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=600&auto=format&fit=crop&q=80',
              fileKey: 'demo/how-to-build-a-professional-nursing-portfolio.pdf',
              isDemo: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              id: '9f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b03',
              slug: 'how-to-present-yourself-professionally-as-a-nursing-leader',
              title: 'How to Present Yourself Professionally as a Nursing Leader',
              description: 'Master executive presence, professional branding, client communication, and public speaking in healthcare and corporate leadership.',
              author: 'Gileo Medicals Global Limited',
              priceKobo: 1800000,
              priceLabel: '₦18,000 • Executive Presence Guide',
              isIndicative: false,
              coverImage: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600&auto=format&fit=crop&q=80',
              fileKey: 'demo/how-to-present-yourself-professionally-as-a-nursing-leader.pdf',
              isDemo: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              id: '9f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b04',
              slug: 'how-to-build-a-career-in-nursing-leadership',
              title: 'How to Build a Career in Nursing Leadership',
              description: 'Strategic roadmap for transitioning from bedside care to clinical management, nursing operations, and executive leadership.',
              author: 'Gileo Medicals Global Limited',
              priceKobo: 2000000,
              priceLabel: '₦20,000 • Career Roadmap',
              isIndicative: false,
              coverImage: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=600&auto=format&fit=crop&q=80',
              fileKey: 'demo/how-to-build-a-career-in-nursing-leadership.pdf',
              isDemo: true,
              status: ContentStatus.PUBLISHED,
            },
            {
              id: '9f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b05',
              slug: 'global-nursing-careers-and-opportunities',
              title: 'Global Nursing Careers and Opportunities',
              description: 'Comprehensive international guide for registration, licensure evaluation (UK, US, Canada, Australia), and relocation sponsorship.',
              author: 'Gileo Medicals Global Limited',
              priceKobo: 2500000,
              priceLabel: '₦25,000 • Global Mobility Guide',
              isIndicative: false,
              coverImage: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=600&auto=format&fit=crop&q=80',
              fileKey: 'demo/global-nursing-careers-and-opportunities.pdf',
              isDemo: true,
              status: ContentStatus.PUBLISHED,
            },
          ],
        });
      }

      const cohortCount = await this.prisma.elevateCohort.count({ where: { status: ContentStatus.PUBLISHED } });
      if (cohortCount === 0) {
        await this.prisma.elevateCohort.createMany({
          skipDuplicates: true,
          data: [
            {
              id: '8f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b5c',
              slug: 'nurse-concierge-leadership-2026',
              title: 'Nurse Concierge & Executive Leadership Cohort',
              overview: 'A 6-week intensive cohort for nurses seeking independent practice, concierge healthcare consulting, and international leadership opportunities.',
              learningOutcomes: [
                'Nurse Concierge Business Model & Operations',
                'International Career Registration & Pathways',
                'Executive Nursing Portfolio Development',
                'Clinical Quality & Contract Management',
              ] as any,
              startsAt: new Date('2026-11-15T09:00:00.000Z'),
              endsAt: new Date('2026-12-20T17:00:00.000Z'),
              priceKobo: 15000000,
              capacity: 30,
              enrolledCount: 14,
              reservedCount: 0,
              status: ContentStatus.PUBLISHED,
            },
            {
              id: '8f2d3a1b-4c5e-6f7a-8b9c-0d1e2f3a4b5d',
              slug: 'global-nursing-career-pathways-2026',
              title: 'Global Nursing Career & Migration Pathways',
              overview: 'A 4-week cohort focused on international nursing licensure (UK, US, Canada, Australia), documentation, and visa sponsorship strategies.',
              learningOutcomes: [
                'NCLEX, NMC & AHPRA Registration Roadmap',
                'Sponsorship Interview Preparation',
                'Global Nursing Resume & Portfolio Optimization',
              ] as any,
              startsAt: new Date('2026-12-01T09:00:00.000Z'),
              endsAt: new Date('2026-12-28T17:00:00.000Z'),
              priceKobo: 12000000,
              capacity: 40,
              enrolledCount: 22,
              reservedCount: 0,
              status: ContentStatus.PUBLISHED,
            },
          ],
        });
      }



      const resourceCount = await this.prisma.communityResource.count();
      if (resourceCount === 0) {
        await this.prisma.communityResource.createMany({
          skipDuplicates: true,
          data: [
            {
              slug: 'career-pathways-beyond-bedside-nursing',
              title: 'Career Pathways Beyond Bedside Nursing',
              description: 'A comprehensive starter guide for registered nurses interested in independent concierge nursing, health consulting, and corporate health services.',
              content: `Key Focus Areas:
1. Executive Nursing & Concierge Services: Providing personalized, premium healthcare coordination and home recovery management.
2. Corporate Health & Wellness Consultancy: Designing employee wellness checks and occupational health protocols.
3. Medical Production & Event Coverage: Providing clinical oversight for TV/Film productions and high-profile events.
4. Continuous Skill Upgrade: Building leadership, client communication, and healthcare business acumen.`,
              status: ContentStatus.PUBLISHED,
            },
            {
              slug: 'executive-nursing-portfolio-template',
              title: 'Executive Nursing Portfolio Blueprint & Template',
              description: 'Step-by-step framework for packaging your clinical experience, certifications, and leadership achievements for global practice opportunities.',
              content: `Portfolio Structure:
- Executive Summary & Personal Statement
- Key Clinical Competencies & Specializations
- Professional Certifications & Academic Credentials
- Leadership, Mentorship & Project Highlights
- Client Testimonials & Employer Recommendations`,
              status: ContentStatus.PUBLISHED,
            },
            {
              slug: 'international-nursing-licensure-roadmap',
              title: 'NCLEX & Global Nursing Licensure Roadmap',
              description: 'Essential timeline and documentation checklist for nurses preparing for international credential evaluation (UK, US, Canada, Australia).',
              content: `Step 1: Credential Evaluation (CGFNS / NMC / AHPRA)
Step 2: English Language Proficiency (IELTS Academic / OET)
Step 3: Exam Preparation (NCLEX-RN / CBT)
Step 4: Visa Sponsorship & Interview Preparation`,
              status: ContentStatus.PUBLISHED,
            },
          ],
        });
      }

      const announcementCount = await this.prisma.announcement.count();
      if (announcementCount === 0) {
        await this.prisma.announcement.createMany({
          skipDuplicates: true,
          data: [
            {
              slug: 'welcome-to-gileo-nurses-community',
              title: 'Welcome to Gileo Nurses Community!',
              body: 'We are thrilled to welcome you to the Gileo Nurses Community — a dedicated space for nurses to explore career pathways beyond bedside roles, access free professional resources, share insights, and connect with global peers.',
              status: ContentStatus.PUBLISHED,
              publishedAt: new Date(),
            },
            {
              slug: 'gileo-elevate-cohorts-enrolment-open',
              title: 'Gileo Elevate November Cohort Enrolments Now Open',
              body: 'Applications for the upcoming Nurse Concierge & Executive Leadership Cohort are now live. Reserve your seat early to access exclusive mentorship sessions and structured business models.',
              status: ContentStatus.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        });
      }
    } catch (err) {
      console.error('Cohort & Community seed failed:', err);
    }
  }

  async listCohorts() {
    await this.seedDemoCohortsAndCommunityIfNeeded();
    return this.prisma.elevateCohort.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: { startsAt: 'asc' } });
  }
  async createCohort(userId: string, dto: CreateCohortDto) {
    await this.requirePermission(userId, 'LEARNING_MANAGE');
    if (dto.capacity && dto.capacity < 1) throw new BadRequestException('Capacity must be positive.');
    return this.prisma.elevateCohort.create({ data: { ...dto, learningOutcomes: dto.learningOutcomes, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateCohort(userId: string, id: string, dto: UpdateCohortDto) {
    await this.requirePermission(userId, 'LEARNING_MANAGE');
    if (!(await this.prisma.elevateCohort.findUnique({ where: { id } }))) throw new NotFoundException('Cohort not found.');
    if (dto.capacity !== undefined) {
      const cohort = await this.prisma.elevateCohort.findUnique({ where: { id }, select: { enrolledCount: true, reservedCount: true } });
      if (cohort && dto.capacity < cohort.enrolledCount + cohort.reservedCount) throw new BadRequestException('Capacity cannot be lower than current enrolments plus active checkout reservations.');
    }
    return this.prisma.elevateCohort.update({ where: { id }, data: {
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      learningOutcomes: dto.learningOutcomes as any,
    } });
  }
  async ebookContent(userId: string, ebookId: string) {
    await this.requireUser(userId);
    const ebook = await this.prisma.ebook.findFirst({ where: { id: ebookId, status: ContentStatus.PUBLISHED }, select: { id: true, title: true, fileKey: true } });
    if (!ebook || !ebook.fileKey) throw new NotFoundException('E-book content is not available.');
    const entitlement = await this.prisma.entitlement.findFirst({ where: { userId, type: EntitlementType.EBOOK, ebookId, revokedAt: null } });
    if (!entitlement) throw new ForbiddenException('A verified purchase is required to access this e-book.');
    const root = this.ebookStorageRoot();
    const filePath = resolve(root, ebook.fileKey);
    if (filePath !== root && !filePath.startsWith(root + sep)) throw new ForbiddenException('Invalid e-book storage key.');
    try { await stat(filePath); } catch { throw new NotFoundException('E-book file was not found in private storage.'); }
    return { stream: createReadStream(filePath), filename: basename(filePath), title: ebook.title };
  }
  async uploadEbookContent(adminId: string, ebookId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    await this.requirePermission(adminId, 'LEARNING_MANAGE');
    if (!file || !file.buffer || !file.size) throw new BadRequestException('A file is required.');
    if (file.size > 25 * 1024 * 1024) throw new BadRequestException('E-book files must be 25 MB or smaller.');
    if (!['application/pdf'].includes(file.mimetype) || extname(file.originalname).toLowerCase() !== '.pdf' || file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new BadRequestException('Only valid PDF e-books are supported.');
    if (!(await this.prisma.ebook.findUnique({ where: { id: ebookId }, select: { id: true } }))) throw new NotFoundException('E-book not found.');
    const root = this.ebookStorageRoot(); await mkdir(root, { recursive: true });
    const key = `${ebookId}/${randomBytes(18).toString('hex')}.pdf`;
    const destination = resolve(root, key);
    if (!destination.startsWith(root + sep)) throw new BadRequestException('Invalid storage destination.');
    await mkdir(resolve(root, ebookId), { recursive: true }); await writeFile(destination, file.buffer, { flag: 'wx', mode: 0o600 });
    return this.prisma.ebook.update({ where: { id: ebookId }, data: { fileKey: key }, select: { id: true, title: true, fileKey: true } });
  }
  async myLibrary(userId: string) {
    await this.requireUser(userId);
    const [ebooks, cohorts] = await Promise.all([
      this.prisma.entitlement.findMany({ where: { userId, type: EntitlementType.EBOOK, revokedAt: null }, include: { ebook: { select: { id: true, title: true, description: true, coverImage: true } } } }),
      this.prisma.entitlement.findMany({ where: { userId, type: EntitlementType.ELEVATE_COHORT, revokedAt: null }, include: { cohort: { select: { id: true, title: true, overview: true, startsAt: true, endsAt: true } } } }),
    ]);
    return { ebooks: ebooks.map(x => x.ebook).filter(Boolean), cohorts: cohorts.map(x => x.cohort).filter(Boolean) };
  }
  async cohortContent(userId: string, cohortId: string) {
    await this.requireUser(userId);
    const entitlement = await this.prisma.entitlement.findFirst({
      where: { userId, type: EntitlementType.ELEVATE_COHORT, cohortId, revokedAt: null },
    });
    if (!entitlement) {
      throw new ForbiddenException('A verified enrolment entitlement is required to access this cohort\'s member resources.');
    }
    const cohort = await this.prisma.elevateCohort.findUnique({
      where: { id: cohortId },
    });
    if (!cohort) throw new NotFoundException('Cohort not found.');

    return {
      cohortId: cohort.id,
      title: cohort.title,
      schedule: cohort.schedule || 'Weekly Live Masterclasses on Saturdays at 10:00 AM WAT via Gileo Elevate Portal.',
      overview: cohort.overview,
      learningOutcomes: cohort.learningOutcomes,
      memberMaterials: [
        {
          id: 'mat-1',
          title: 'Gileo Elevate Cohort Handbook & Orientation Guide',
          description: 'Weekly breakdown, masterclass schedules, and project milestone rubrics.',
          type: 'GUIDE',
        },
        {
          id: 'mat-2',
          title: 'Executive Nursing Portfolio & CV Workbooks',
          description: 'Editable templates and case studies for structuring international leadership portfolios.',
          type: 'TEMPLATE',
        },
        {
          id: 'mat-3',
          title: 'Live Workshop Portal & Class Recordings Archive',
          description: 'Direct access link to weekly Zoom live streams and archived video lectures.',
          type: 'PORTAL_LINK',
        },
      ],
      announcements: [
        {
          id: 'ann-c1',
          title: 'Welcome to your Gileo Elevate Cohort!',
          body: 'Check the orientation handbook and join our private cohort group for peer networking.',
          createdAt: cohort.createdAt.toISOString(),
        },
      ],
    };
  }
  async communityMembers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        displayName: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private postLikesMap = new Map<string, Set<string>>();
  private postCommentsMap = new Map<string, Array<{ id: string; authorName: string; text: string; createdAt: number }>>();
  private userConnectionsMap = new Map<string, Set<string>>();
  private userSavedPostsMap = new Map<string, Set<string>>();

  async getCommunityPosts(authorIdFilter?: string, currentUserId?: string) {
    await this.seedDemoCohortsAndCommunityIfNeeded();
    const whereCondition = authorIdFilter ? { authorId: authorIdFilter } : {};

    const posts = await this.prisma.communityPost.findMany({
      where: whereCondition,
      include: {
        likes: true,
        comments: { orderBy: { createdAt: 'asc' } },
        reposts: true,
        savedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return posts.map((p) => {
      const isLiked = currentUserId ? p.likes.some((l) => l.userId === currentUserId) : false;
      const isSaved = currentUserId ? p.savedBy.some((s) => s.userId === currentUserId) : false;
      const isReposted = currentUserId ? p.reposts.some((r) => r.userId === currentUserId) : false;

      return {
        id: p.id,
        authorId: p.authorId,
        authorName: p.authorName,
        authorRole: p.authorRole,
        title: p.title,
        content: p.content,
        category: p.category,
        createdAt: p.createdAt.getTime(),
        likesCount: p.likes.length,
        isLiked,
        isSaved,
        repostsCount: p.reposts.length,
        isReposted,
        commentsCount: p.comments.length,
        commentsList: p.comments.map((c) => ({
          id: c.id,
          authorName: c.authorName,
          text: c.text,
          createdAt: c.createdAt.getTime(),
        })),
      };
    });
  }

  async repostCommunityPost(userId: string, postId: string) {
    await this.requireUser(userId);
    const existing = await this.prisma.communityPostRepost.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    let isReposted = false;
    if (existing) {
      await this.prisma.communityPostRepost.delete({ where: { id: existing.id } });
      isReposted = false;
    } else {
      await this.prisma.communityPostRepost.create({
        data: { postId, userId },
      });
      isReposted = true;
    }

    const repostsCount = await this.prisma.communityPostRepost.count({ where: { postId } });
    return { postId, repostsCount, isReposted };
  }

  async getMemberProfile(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, displayName: true, email: true, role: true, createdAt: true },
    });

    if (!user) {
      return {
        id: targetUserId,
        displayName: targetUserId,
        role: 'Registered Nurse',
        connectionsCount: 1,
        postsCount: 1,
      };
    }

    const [connectionsCount, postsCount] = await Promise.all([
      this.prisma.userConnection.count({
        where: { OR: [{ userId: user.id }, { targetUserId: user.id }] },
      }),
      this.prisma.communityPost.count({ where: { authorId: user.id } }),
    ]);

    return {
      id: user.id,
      displayName: user.displayName || 'Gileo Member',
      role: user.role === UserRole.ADMIN ? 'Gileo Health Leader' : 'Registered Nurse',
      createdAt: user.createdAt,
      connectionsCount: Math.max(connectionsCount, 1),
      postsCount,
    };
  }

  async likeCommunityPost(userId: string, postId: string) {
    await this.requireUser(userId);
    const existing = await this.prisma.communityPostLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    let isLiked = false;
    if (existing) {
      await this.prisma.communityPostLike.delete({ where: { id: existing.id } });
      isLiked = false;
    } else {
      await this.prisma.communityPostLike.create({
        data: { postId, userId },
      });
      isLiked = true;
    }

    const likesCount = await this.prisma.communityPostLike.count({ where: { postId } });
    return { postId, likesCount, isLiked };
  }

  async commentCommunityPost(userId: string, postId: string, dto: { text: string }) {
    await this.requireUser(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
    const authorName = user?.displayName || user?.email?.split('@')[0] || 'Gileo Nurse';

    const comment = await this.prisma.communityPostComment.create({
      data: {
        postId,
        authorId: userId,
        authorName,
        text: dto.text,
      },
    });

    const commentsCount = await this.prisma.communityPostComment.count({ where: { postId } });
    const commentsList = await this.prisma.communityPostComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      postId,
      comment: {
        id: comment.id,
        authorName: comment.authorName,
        text: comment.text,
        createdAt: comment.createdAt.getTime(),
      },
      commentsCount,
      commentsList: commentsList.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        text: c.text,
        createdAt: c.createdAt.getTime(),
      })),
    };
  }

  async createCommunityPost(userId: string, dto: { title?: string; content: string; category?: string }) {
    await this.requireUser(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
    const authorName = user?.displayName || user?.email?.split('@')[0] || 'Gileo Nurse';

    const post = await this.prisma.communityPost.create({
      data: {
        authorId: userId,
        authorName,
        authorRole: 'Gileo Community Member',
        title: dto.title || `Update by ${authorName}`,
        content: dto.content,
        category: dto.category || 'Community Share',
      },
    });

    return {
      id: post.id,
      authorId: post.authorId,
      authorName: post.authorName,
      authorRole: post.authorRole,
      title: post.title,
      content: post.content,
      category: post.category,
      createdAt: post.createdAt.getTime(),
      likesCount: 0,
      commentsCount: 0,
      commentsList: [],
    };
  }

  async getUserConnections(userId: string) {
    await this.requireUser(userId);
    const connections = await this.prisma.userConnection.findMany({
      where: { userId },
      select: { targetUserId: true },
    });
    return connections.map((c) => c.targetUserId);
  }

  async toggleUserConnection(userId: string, targetUserId: string) {
    await this.requireUser(userId);
    const existing = await this.prisma.userConnection.findUnique({
      where: { userId_targetUserId: { userId, targetUserId } },
    });

    let isConnected = false;
    if (existing) {
      await this.prisma.userConnection.delete({ where: { id: existing.id } });
      isConnected = false;
    } else {
      await this.prisma.userConnection.create({
        data: { userId, targetUserId },
      });
      isConnected = true;

      const sender = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      await this.createNotification(targetUserId, {
        title: 'New Connection Request',
        body: `${sender?.displayName || 'A Gileo Nurse'} sent you a connection request.`,
        icon: 'person-add',
        iconBg: '#FFF0F0',
        iconColor: '#f90202',
      }).catch(() => null);
    }

    const connectionsCount = await this.prisma.userConnection.count({ where: { userId } });
    const connections = await this.getUserConnections(userId);
    return { targetUserId, isConnected, connectionsCount, connections };
  }

  async getUserNotifications(userId: string) {
    await this.requireUser(userId);
    const notifs = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (notifs.length === 0) {
      const defaultNotif = await this.prisma.notification.create({
        data: {
          userId,
          title: 'Welcome to Gileo Medicals',
          body: 'Explore healthcare services, medical marketplace, and community network.',
          icon: 'sparkles',
          iconBg: '#FFF0F0',
          iconColor: '#f90202',
          read: false,
        },
      });
      return [
        {
          id: defaultNotif.id,
          title: defaultNotif.title,
          body: defaultNotif.body,
          timeAgo: 'Just now',
          timestamp: defaultNotif.createdAt.getTime(),
          icon: defaultNotif.icon,
          iconBg: defaultNotif.iconBg,
          iconColor: defaultNotif.iconColor,
          read: defaultNotif.read,
        },
      ];
    }

    return notifs.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      timeAgo: 'Just now',
      timestamp: n.createdAt.getTime(),
      icon: n.icon,
      iconBg: n.iconBg,
      iconColor: n.iconColor,
      read: n.read,
    }));
  }

  async createNotification(targetUserId: string, dto: { title: string; body: string; icon?: string; iconBg?: string; iconColor?: string }) {
    return this.prisma.notification.create({
      data: {
        userId: targetUserId,
        title: dto.title,
        body: dto.body,
        icon: dto.icon || 'notifications',
        iconBg: dto.iconBg || '#FFF0F0',
        iconColor: dto.iconColor || '#f90202',
      },
    });
  }

  async markNotificationsRead(userId: string) {
    await this.requireUser(userId);
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  async getUserSavedPosts(userId: string) {
    await this.requireUser(userId);
    const saved = await this.prisma.savedPost.findMany({
      where: { userId },
      include: {
        post: {
          include: {
            likes: true,
            comments: { orderBy: { createdAt: 'asc' } },
            savedBy: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return saved.map((s) => {
      const p = s.post;
      return {
        id: p.id,
        authorId: p.authorId,
        authorName: p.authorName,
        authorRole: p.authorRole,
        title: p.title,
        content: p.content,
        category: p.category,
        createdAt: p.createdAt.getTime(),
        likesCount: p.likes.length,
        isLiked: p.likes.some((l) => l.userId === userId),
        isSaved: true,
        commentsCount: p.comments.length,
        commentsList: p.comments.map((c) => ({
          id: c.id,
          authorName: c.authorName,
          text: c.text,
          createdAt: c.createdAt.getTime(),
        })),
      };
    });
  }

  async toggleSavePost(userId: string, postId: string) {
    await this.requireUser(userId);
    const existing = await this.prisma.savedPost.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    let isSaved = false;
    if (existing) {
      await this.prisma.savedPost.delete({ where: { id: existing.id } });
      isSaved = false;
    } else {
      await this.prisma.savedPost.create({
        data: { userId, postId },
      });
      isSaved = true;
    }

    const savedPostsCount = await this.prisma.savedPost.count({ where: { userId } });
    return { postId, isSaved, savedPostsCount };
  }

  async joinCommunity(userId: string) {
    await this.requireUser(userId);
    return this.prisma.communityMembership.upsert({ where: { userId }, create: { userId }, update: {} });
  }
  async communityResources() {
    await this.seedDemoCohortsAndCommunityIfNeeded();
    const [resources, announcements] = await Promise.all([
      this.prisma.communityResource.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: { createdAt: 'desc' } }),
      this.prisma.announcement.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: { publishedAt: 'desc' } }),
    ]);
    return { resources, announcements };
  }
  async createCommunityResource(userId: string, dto: CreateCommunityResourceDto) {
    await this.requirePermission(userId, 'COMMUNITY_MANAGE');
    return this.prisma.communityResource.create({ data: { ...dto, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async createAnnouncement(userId: string, dto: CreateAnnouncementDto) {
    await this.requirePermission(userId, 'COMMUNITY_MANAGE');
    const status = dto.status ?? ContentStatus.DRAFT;
    return this.prisma.announcement.create({ data: { ...dto, status, publishedAt: status === ContentStatus.PUBLISHED ? new Date() : undefined } });
  }
  async adminDashboard(userId: string) {
    await this.requirePermission(userId, 'DASHBOARD_READ');
    const [newServiceRequests, openOrders, pendingPayments, openSupportTickets, lowStockVariants, cohortEnrollments, ebookPurchases] = await Promise.all([
      this.prisma.serviceRequest.count({ where: { status: { in: [ServiceRequestStatus.SUBMITTED, ServiceRequestStatus.UNDER_REVIEW] } } }),
      this.prisma.order.count({ where: { status: { in: [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.FULFILMENT] } } }),
      this.prisma.payment.count({ where: { status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] } } }),
      this.prisma.supportTicket.count({ where: { status: { in: [SupportStatus.OPEN, SupportStatus.IN_PROGRESS] } } }),
      this.prisma.productVariant.count({ where: { stock: { lte: 5 }, isAvailable: true } }),
      this.prisma.cohortEnrollment.count({ where: { status: 'ACTIVE' } }),
      this.prisma.learningPurchase.count(),
    ]);
    return { newServiceRequests, openOrders, pendingPayments, openSupportTickets, lowStockVariants, cohortEnrollments, ebookPurchases };
  }
  async listPayments(userId: string) {
    await this.requirePermission(userId, 'PAYMENTS_READ');
    return this.prisma.payment.findMany({ select: { id: true, reference: true, purchaseType: true, amountKobo: true, currency: true, status: true, createdAt: true, paidAt: true, verifiedAt: true, user: { select: { id: true, email: true, displayName: true } }, order: { select: { reference: true, status: true } }, serviceRequest: { select: { reference: true, status: true } }, ebook: { select: { id: true, title: true } }, cohort: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  async createSupportTicket(userId: string, dto: CreateSupportTicketDto) {
    await this.requireUser(userId);
    return this.prisma.supportTicket.create({ data: { reference: this.ref('SUP'), userId, ...dto } });
  }
  async mySupportTickets(userId: string) {
    await this.requireUser(userId);
    return this.prisma.supportTicket.findMany({ where: { userId }, include: { messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } });
  }
  async listSupportTickets(userId: string) {
    await this.requirePermission(userId, 'SUPPORT_MANAGE');
    return this.prisma.supportTicket.findMany({ include: { user: { select: { id: true, email: true, displayName: true } }, messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } });
  }
  async assignSupportTicket(adminId: string, ticketId: string, assignedTo?: string | null) {
    await this.requirePermission(adminId, 'SUPPORT_MANAGE');
    if (assignedTo) { const assignee = await this.prisma.user.findUnique({ where: { id: assignedTo }, select: { id: true, role: true } }); if (!assignee) throw new BadRequestException('Ticket assignee was not found.'); if (assignee.role !== UserRole.ADMIN && !(await this.prisma.userPermission.findUnique({ where: { userId_permission: { userId: assignedTo, permission: 'SUPPORT_MANAGE' } }, select: { id: true } }))) throw new BadRequestException('The assignee must have the SUPPORT_MANAGE permission.'); }
    if (!(await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true } }))) throw new NotFoundException('Support ticket not found.');
    return this.prisma.supportTicket.update({ where: { id: ticketId }, data: { assignedTo: assignedTo ?? null } });
  }
  async addSupportMessage(userId: string, ticketId: string, message: string) {
    const user = await this.requireUser(userId);
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, userId: true, status: true } });
    if (!ticket) throw new NotFoundException('Support ticket not found.');
    if (ticket.userId !== userId && user.role !== UserRole.ADMIN) throw new ForbiddenException('You cannot access this support ticket.');
    if (ticket.status === SupportStatus.CLOSED) throw new BadRequestException('This ticket is closed.');
    const result = await this.prisma.supportMessage.create({ data: { ticketId, authorId: userId, message: message.trim(), internal: false }, include: { author: { select: { id: true, displayName: true, role: true } } } });
    if (ticket.status === SupportStatus.RESOLVED && ticket.userId === userId) await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: SupportStatus.OPEN } });
    return result;
  }
  async updateSupportTicket(userId: string, id: string, dto: UpdateStatusDto) {
    await this.requirePermission(userId, 'SUPPORT_MANAGE');
    if (!Object.values(SupportStatus).includes(dto.status as SupportStatus)) throw new BadRequestException('Invalid support ticket status.');
    if (!(await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Support ticket not found.');
    return this.prisma.supportTicket.update({ where: { id }, data: { status: dto.status as SupportStatus } });
  }

  private async paystackRequest(path: string, method: 'GET'|'POST', body?: Record<string, unknown>) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new ServiceUnavailableException('Paystack is not configured. Set PAYSTACK_SECRET_KEY in the server environment.');
    const response = await fetch(`${paystackBase}${path}`, {
      method, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json() as { status?: boolean; message?: string; data?: any };
    if (!response.ok || !data.status) throw new BadRequestException(data.message || 'Paystack request failed.');
    return data.data;
  }
  async initializePayment(userId: string, dto: InitializePaymentDto) {
    const user = await this.requireUser(userId);
    await this.releaseExpiredOrders();
    if (!user.email) throw new BadRequestException('An email address is required to make a payment.');
    let amountKobo = 0, orderId: string|undefined, serviceRequestId: string|undefined, ebookId: string|undefined, cohortId: string|undefined;
    switch (dto.purchaseType) {
      case PurchaseType.SHOP_ORDER: {
        const order = await this.prisma.order.findFirst({ where: { id: dto.targetId, userId } });
        if (!order) throw new NotFoundException('Order not found.');
        if (order.status !== OrderStatus.PENDING_PAYMENT || (order.reservationExpiresAt && order.reservationExpiresAt <= new Date()) || order.stockReleasedAt) throw new BadRequestException('This order is not awaiting payment or its stock reservation has expired. Please create a new order.');
        amountKobo = order.totalKobo; orderId = order.id; break;
      }
      case PurchaseType.SERVICE_REQUEST: {
        const request = await this.prisma.serviceRequest.findFirst({ where: { id: dto.targetId, userId }, include: { service: true } });
        if (!request) throw new NotFoundException('Service request not found.');
        if (request.status !== ServiceRequestStatus.ACCEPTED || !request.availabilityConfirmed) throw new BadRequestException('GILEO must confirm availability before payment.');
        amountKobo = request.amountKobo ?? request.service.priceKobo ?? 0; serviceRequestId = request.id;
        if (amountKobo <= 0) throw new BadRequestException('This service does not have a payable price yet. Contact customer service.'); break;
      }
      case PurchaseType.EBOOK: {
        const ebook = await this.prisma.ebook.findFirst({ where: { id: dto.targetId, status: ContentStatus.PUBLISHED } });
        if (!ebook) throw new NotFoundException('E-book not found.');
        if (await this.prisma.entitlement.findFirst({ where: { userId, ebookId: ebook.id, revokedAt: null } })) throw new BadRequestException('You already have access to this e-book.');
        amountKobo = ebook.priceKobo; ebookId = ebook.id; break;
      }
      case PurchaseType.ELEVATE_COHORT: {
        const cohort = await this.prisma.elevateCohort.findFirst({ where: { id: dto.targetId, status: ContentStatus.PUBLISHED } });
        if (!cohort) throw new NotFoundException('Cohort not found.');
        if (cohort.capacity !== null && cohort.enrolledCount + cohort.reservedCount >= cohort.capacity) throw new BadRequestException('This cohort is full.');
        if (await this.prisma.entitlement.findFirst({ where: { userId, cohortId: cohort.id, revokedAt: null } })) throw new BadRequestException('You already have access to this cohort.');
        amountKobo = cohort.priceKobo; cohortId = cohort.id; break;
      }
    }
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) throw new BadRequestException('Invalid payment amount.');
    const activeKey = `${userId}:${dto.purchaseType}:${dto.targetId}`;
    const existingActivePayment = await this.prisma.payment.findUnique({ where: { activeKey } });
    if (existingActivePayment && existingActivePayment.userId === userId && ([PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] as PaymentStatus[]).includes(existingActivePayment.status)) {
      if (existingActivePayment.authorizationUrl) return { id: existingActivePayment.id, reference: existingActivePayment.reference, amountKobo: existingActivePayment.amountKobo, currency: existingActivePayment.currency, status: existingActivePayment.status, authorizationUrl: existingActivePayment.authorizationUrl, paystackAccessCode: existingActivePayment.paystackAccessCode };
      throw new BadRequestException('A payment initialization for this purchase is already in progress. Retry shortly.');
    }
    let cohortSlotReserved = false;
    if (cohortId) {
      const reserved = await this.prisma.$executeRaw`UPDATE elevate_cohorts SET "reservedCount" = "reservedCount" + 1 WHERE id = ${cohortId}::uuid AND (capacity IS NULL OR "enrolledCount" + "reservedCount" < capacity)`;
      if (Number(reserved) !== 1) throw new BadRequestException('This cohort has reached capacity.');
      cohortSlotReserved = true;
    }
    const reference = `GIL-${randomBytes(18).toString('hex')}`;
    let payment: any;
    try {
      payment = await this.prisma.payment.create({ data: { reference, activeKey, userId, purchaseType: dto.purchaseType, amountKobo, currency: 'NGN', status: PaymentStatus.INITIALIZED, orderId, serviceRequestId, ebookId, cohortId, cohortSeatReserved: cohortSlotReserved } });
    } catch (error) {
      if (cohortSlotReserved && cohortId) await this.prisma.elevateCohort.updateMany({ where: { id: cohortId, reservedCount: { gt: 0 } }, data: { reservedCount: { decrement: 1 } } });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const active = await this.prisma.payment.findUnique({ where: { activeKey } });
        if (active?.authorizationUrl) return { id: active.id, reference: active.reference, amountKobo: active.amountKobo, currency: active.currency, status: active.status, authorizationUrl: active.authorizationUrl, paystackAccessCode: active.paystackAccessCode };
        throw new BadRequestException('A payment initialization for this purchase is already in progress. Retry shortly.');
      }
      throw error;
    }
    try {
      const gateway = await this.paystackRequest('/transaction/initialize', 'POST', {
        email: user.email, amount: amountKobo, currency: 'NGN', reference,
        callback_url: this.config.get<string>('PAYSTACK_CALLBACK_URL') || 'gileo://payment-callback',
        metadata: { paymentId: payment.id, userId, purchaseType: dto.purchaseType, targetId: dto.targetId },
      });
      return await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PENDING, paystackAccessCode: gateway.access_code, authorizationUrl: gateway.authorization_url }, select: { id: true, reference: true, amountKobo: true, currency: true, status: true, authorizationUrl: true, paystackAccessCode: true } });
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, activeKey: null, cohortSeatReserved: false } });
      if (cohortSlotReserved && cohortId) await this.prisma.elevateCohort.update({ where: { id: cohortId }, data: { reservedCount: { decrement: 1 } } });
      throw error;
    }
  }
  async verifyPayment(userId: string, reference: string) {
    await this.requireUser(userId);
    const payment = await this.prisma.payment.findFirst({ where: { reference, userId } });
    if (!payment) throw new NotFoundException('Payment reference not found.');
    return this.verifyAndFulfil(reference);
  }
  async verifyAndFulfil(reference: string) {
    await this.releaseExpiredOrders();
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment reference not found.');
    if (payment.status === PaymentStatus.VERIFIED) return { status: 'success', message: 'Payment already verified.', reference };
    if (payment.status === PaymentStatus.REFUNDED || payment.status === PaymentStatus.REFUND_PENDING) throw new BadRequestException('This payment is being refunded or has already been refunded.');
    if (payment.status === PaymentStatus.CANCELLED) throw new BadRequestException('This payment reservation expired or was cancelled. If the customer was charged, an administrator must reconcile the transaction before granting the order or access.') ;
    const gateway = await this.paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, 'GET') as any;
    if (gateway.status !== 'success' || gateway.reference !== reference || gateway.amount !== payment.amountKobo || gateway.currency !== payment.currency) {
      const failed = await this.prisma.payment.updateMany({ where: { id: payment.id, status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] } }, data: { status: PaymentStatus.FAILED, activeKey: null, cohortSeatReserved: false, gatewayResponse: gateway } });
      if (failed.count && payment.cohortId && payment.cohortSeatReserved) await this.prisma.elevateCohort.updateMany({ where: { id: payment.cohortId, reservedCount: { gt: 0 } }, data: { reservedCount: { decrement: 1 } } });
      throw new BadRequestException('Paystack transaction did not match the expected amount, currency, reference, or successful status.');
    }
    await this.prisma.$transaction(async tx => {
      const locked = await tx.payment.findUnique({ where: { id: payment.id } });
      if (!locked) throw new NotFoundException('Payment not found.');
      if (locked.status === PaymentStatus.VERIFIED) return;
      if (!([PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] as PaymentStatus[]).includes(locked.status)) throw new BadRequestException('Payment status changed while verification was in progress. An administrator must reconcile this transaction.');
      if (payment.orderId) {
        const order = await tx.order.findUnique({ where: { id: payment.orderId }, select: { status: true, stockReleasedAt: true, reservationExpiresAt: true } });
        if (!order || order.status !== OrderStatus.PENDING_PAYMENT || order.stockReleasedAt || (order.reservationExpiresAt && order.reservationExpiresAt <= new Date())) throw new BadRequestException('The order reservation has expired or been cancelled. An administrator must reconcile this transaction before fulfilment.');
      }
      const markedVerified = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING, PaymentStatus.AWAITING_VERIFICATION] } },
        data: { status: PaymentStatus.VERIFIED, activeKey: null, cohortSeatReserved: false, verifiedAt: new Date(), paidAt: gateway.paid_at ? new Date(gateway.paid_at) : new Date(), paystackTransactionId: String(gateway.id), gatewayResponse: gateway },
      });
      if (markedVerified.count !== 1) return;
      if (payment.orderId) {
        const paidOrder = await tx.order.updateMany({ where: { id: payment.orderId, status: OrderStatus.PENDING_PAYMENT, stockReleasedAt: null, OR: [{ reservationExpiresAt: null }, { reservationExpiresAt: { gt: new Date() } }] }, data: { status: OrderStatus.PAID } });
        if (paidOrder.count !== 1) throw new BadRequestException('Order reservation expired during payment verification; an administrator must reconcile the charge.');
      }
      if (payment.serviceRequestId) {
        const paidRequest = await tx.serviceRequest.updateMany({ where: { id: payment.serviceRequestId, status: ServiceRequestStatus.ACCEPTED, availabilityConfirmed: true }, data: { status: ServiceRequestStatus.PAID } });
        if (paidRequest.count !== 1) throw new BadRequestException('Service request status changed during payment verification; an administrator must reconcile the charge.');
      }
      if (payment.ebookId) {
        await tx.learningPurchase.upsert({ where: { userId_ebookId: { userId: payment.userId, ebookId: payment.ebookId } }, create: { userId: payment.userId, ebookId: payment.ebookId, paymentId: payment.id }, update: { paymentId: payment.id } });
        const existingEntitlement = await tx.entitlement.findFirst({ where: { userId: payment.userId, type: EntitlementType.EBOOK, ebookId: payment.ebookId, revokedAt: null } });
        if (!existingEntitlement) await tx.entitlement.create({ data: { userId: payment.userId, type: EntitlementType.EBOOK, ebookId: payment.ebookId } });
      }
      if (payment.cohortId) {
        if (payment.cohortSeatReserved) await tx.elevateCohort.updateMany({ where: { id: payment.cohortId, reservedCount: { gt: 0 } }, data: { reservedCount: { decrement: 1 } } });
        await tx.cohortEnrollment.upsert({ where: { userId_cohortId: { userId: payment.userId, cohortId: payment.cohortId } }, create: { userId: payment.userId, cohortId: payment.cohortId, paymentId: payment.id, status: 'ACTIVE' }, update: { paymentId: payment.id, status: 'ACTIVE' } });
        const existingEntitlement = await tx.entitlement.findFirst({ where: { userId: payment.userId, type: EntitlementType.ELEVATE_COHORT, cohortId: payment.cohortId, revokedAt: null } });
        if (!existingEntitlement) {
          await tx.entitlement.create({ data: { userId: payment.userId, type: EntitlementType.ELEVATE_COHORT, cohortId: payment.cohortId } });
          await tx.elevateCohort.update({ where: { id: payment.cohortId }, data: { enrolledCount: { increment: 1 } } });
        }
      }
    });
    return { status: 'success', message: 'Payment verified successfully.', reference };
  }
  async reconcileCancelledPayment(adminId: string, reference: string) {
    await this.requireAdmin(adminId);
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== PaymentStatus.CANCELLED) throw new BadRequestException('Only cancelled/expired payments can use this reconciliation workflow.');
    const gateway = await this.paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, 'GET') as any;
    if (gateway.status !== 'success' || gateway.reference !== reference || gateway.amount !== payment.amountKobo || gateway.currency !== payment.currency) {
      return { status: 'not_verified', reference, message: 'Paystack has not confirmed a successful matching charge. No order or entitlement was changed.' };
    }
    await this.prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.CANCELLED }, data: { status: PaymentStatus.VERIFIED, activeKey: null, cohortSeatReserved: false, verifiedAt: new Date(), paidAt: gateway.paid_at ? new Date(gateway.paid_at) : new Date(), paystackTransactionId: String(gateway.id), gatewayResponse: gateway } });
    return { status: PaymentStatus.VERIFIED, reference, message: 'The charge is verified but was not fulfilled because its reservation had expired. Review the transaction and initiate a refund if appropriate.' };
  }

  async refundPayment(adminId: string, reference: string, reason?: string) {
    await this.requireAdmin(adminId);
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== PaymentStatus.VERIFIED || !payment.paystackTransactionId) throw new BadRequestException('Only verified Paystack payments can be refunded.');
    const claimed = await this.prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.VERIFIED }, data: { status: PaymentStatus.REFUND_PENDING } });
    if (claimed.count !== 1) throw new BadRequestException('This payment is already being refunded or its status changed.');
    // If the network times out after Paystack accepts the request, leave REFUND_PENDING and reconcile rather than risk issuing a duplicate refund.
    const gateway = await this.paystackRequest('/refund', 'POST', {
      transaction: payment.paystackTransactionId,
      ...(reason ? { customer_note: reason.slice(0, 250) } : {}),
    }) as any;
    const status = String(gateway.status ?? '').toLowerCase();
    if (status === 'processed' || status === 'success') {
      await this.prisma.$transaction(async tx => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED, gatewayResponse: gateway } });
        if (payment.orderId) await tx.order.update({ where: { id: payment.orderId }, data: { status: OrderStatus.REFUNDED } });
        if (payment.serviceRequestId) await tx.serviceRequest.update({ where: { id: payment.serviceRequestId }, data: { status: ServiceRequestStatus.CANCELLED } });
        if (payment.ebookId) await tx.entitlement.updateMany({ where: { userId: payment.userId, ebookId: payment.ebookId, revokedAt: null }, data: { revokedAt: new Date() } });
        if (payment.cohortId) {
          await tx.entitlement.updateMany({ where: { userId: payment.userId, cohortId: payment.cohortId, revokedAt: null }, data: { revokedAt: new Date() } });
          const enrollment = await tx.cohortEnrollment.findUnique({ where: { userId_cohortId: { userId: payment.userId, cohortId: payment.cohortId } }, select: { status: true } });
          if (enrollment?.status === 'ACTIVE') {
            await tx.cohortEnrollment.updateMany({ where: { userId: payment.userId, cohortId: payment.cohortId, status: 'ACTIVE' }, data: { status: 'REFUNDED' } });
            await tx.elevateCohort.updateMany({ where: { id: payment.cohortId, enrolledCount: { gt: 0 } }, data: { enrolledCount: { decrement: 1 } } });
          }
        }
      });
      return { status: PaymentStatus.REFUNDED, reference, gatewayStatus: status };
    }
    if (['failed', 'rejected', 'cancelled'].includes(status)) {
      await this.prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.REFUND_PENDING }, data: { status: PaymentStatus.VERIFIED, gatewayResponse: gateway } });
      throw new BadRequestException(`Paystack did not complete the refund (status: ${status}). The payment remains verified and can be reviewed before retrying.`);
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUND_PENDING, gatewayResponse: gateway } });
    return { status: PaymentStatus.REFUND_PENDING, reference, gatewayStatus: status, message: 'Refund status is not yet final. Reconcile with Paystack before taking further action.' };
  }
  async reconcileRefund(adminId: string, reference: string) {
    await this.requireAdmin(adminId);
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status === PaymentStatus.REFUNDED) return { status: PaymentStatus.REFUNDED, reference };
    if (payment.status !== PaymentStatus.REFUND_PENDING || !payment.paystackTransactionId) throw new BadRequestException('Only a pending refund with a known Paystack transaction can be reconciled.');
    const result = await this.paystackRequest(`/refund?transaction=${encodeURIComponent(payment.paystackTransactionId)}`, 'GET') as any;
    const refunds = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : [result]);
    const matching = refunds.find((item: any) => String(item.transaction?.id ?? item.transaction ?? '') === payment.paystackTransactionId || String(item.transaction?.reference ?? '') === reference) ?? refunds[0];
    const status = String(matching?.status ?? '').toLowerCase();
    if (['failed', 'rejected', 'cancelled'].includes(status)) {
      await this.prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.REFUND_PENDING }, data: { status: PaymentStatus.VERIFIED, gatewayResponse: result } });
      return { status: PaymentStatus.VERIFIED, reference, gatewayStatus: status, message: 'Paystack reports that the refund did not complete. The payment is verified and may be reviewed before retrying.' };
    }
    if (!['processed', 'success'].includes(status)) return { status: PaymentStatus.REFUND_PENDING, reference, gatewayStatus: status || 'pending', message: 'The refund is not yet confirmed as processed by Paystack.' };
    await this.prisma.$transaction(async tx => {
      const changed = await tx.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.REFUND_PENDING }, data: { status: PaymentStatus.REFUNDED, gatewayResponse: result } });
      if (!changed.count) return;
      if (payment.orderId) await tx.order.update({ where: { id: payment.orderId }, data: { status: OrderStatus.REFUNDED } });
      if (payment.serviceRequestId) await tx.serviceRequest.update({ where: { id: payment.serviceRequestId }, data: { status: ServiceRequestStatus.CANCELLED } });
      if (payment.ebookId) await tx.entitlement.updateMany({ where: { userId: payment.userId, ebookId: payment.ebookId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (payment.cohortId) {
        await tx.entitlement.updateMany({ where: { userId: payment.userId, cohortId: payment.cohortId, revokedAt: null }, data: { revokedAt: new Date() } });
        const enrollment = await tx.cohortEnrollment.findUnique({ where: { userId_cohortId: { userId: payment.userId, cohortId: payment.cohortId } }, select: { status: true } });
        if (enrollment?.status === 'ACTIVE') {
          await tx.cohortEnrollment.updateMany({ where: { userId: payment.userId, cohortId: payment.cohortId, status: 'ACTIVE' }, data: { status: 'REFUNDED' } });
          await tx.elevateCohort.updateMany({ where: { id: payment.cohortId, enrolledCount: { gt: 0 } }, data: { enrolledCount: { decrement: 1 } } });
        }
      }
    });
    return { status: PaymentStatus.REFUNDED, reference, gatewayStatus: status };
  }

  verifyPaystackSignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret || !rawBody || !signature) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(signature, 'hex'); } catch { return false; }
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  async handlePaystackWebhook(event: any) {
    if (event?.event === 'charge.success' && typeof event?.data?.reference === 'string') {
      return this.verifyAndFulfil(event.data.reference);
    }
    return { received: true };
  }
}
