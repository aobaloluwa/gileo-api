import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ContentStatus, EntitlementType, OrderStatus, PaymentStatus, Prisma, PurchaseType,
  ServiceRequestStatus, SupportStatus, UserRole,
} from '../generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';
import {
  AssignProviderDto, CareOnboardingDto, CreateAnnouncementDto, CreateCategoryDto, CreateCohortDto, CreateCommunityResourceDto, CreateEbookDto, CreateOrderDto,
  CreateProductDto, CreateServiceDto, CreateServiceRequestDto,
  CreateSupportTicketDto, CreateVariantDto, InitializePaymentDto, UpdateCohortDto, UpdateEbookDto, UpdateProductDto, UpdateServiceDto, UpdateStatusDto, UpdateUserRoleDto,
} from './business.dto';

const publicServiceStatus = ContentStatus.PUBLISHED;
const paystackBase = 'https://api.paystack.co';

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async requireUser(userId?: string) {
    if (!userId) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, displayName: true, role: true } });
    if (!user) throw new UnauthorizedException();
    return user;
  }
  private async requireStaff(userId?: string) {
    const user = await this.requireUser(userId);
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPPORT) throw new ForbiddenException('Staff access required.');
    return user;
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
  async updateUserRole(adminId: string, userId: string, dto: UpdateUserRoleDto) {
    await this.requireAdmin(adminId);
    if (adminId === userId && dto.role !== UserRole.ADMIN) throw new BadRequestException('You cannot remove your own administrator role.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found.');
    return this.prisma.user.update({ where: { id: userId }, data: { role: dto.role as UserRole }, select: { id: true, email: true, displayName: true, role: true, createdAt: true } });
  }
  async listServices() {
    return this.prisma.service.findMany({ where: { status: publicServiceStatus }, orderBy: { title: 'asc' } });
  }
  async createService(userId: string, dto: CreateServiceDto) {
    await this.requireAdmin(userId);
    return this.prisma.service.create({ data: { ...dto, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateService(userId: string, id: string, dto: UpdateServiceDto) {
    await this.requireAdmin(userId);
    if (!(await this.prisma.service.findUnique({ where: { id } }))) throw new NotFoundException('Service not found.');
    return this.prisma.service.update({ where: { id }, data: dto });
  }
  async updateServiceStatus(userId: string, id: string, dto: UpdateStatusDto) {
    await this.requireAdmin(userId);
    if (!Object.values(ServiceRequestStatus).includes(dto.status as ServiceRequestStatus)) throw new BadRequestException('Invalid service request status.');
    const request = await this.prisma.serviceRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Service request not found.');
    const status = dto.status as ServiceRequestStatus;
    if (status === ServiceRequestStatus.PAID) throw new BadRequestException('Only verified payment can mark a service request as paid.');
    if (status === ServiceRequestStatus.ASSIGNED) throw new BadRequestException('Use the provider-assignment workflow to assign a nurse.');
    const availabilityConfirmed = status === ServiceRequestStatus.ACCEPTED || request.availabilityConfirmed;
    return this.prisma.serviceRequest.update({ where: { id }, data: { status, availabilityConfirmed, adminNote: dto.note } });
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
    await this.requireStaff(userId);
    return this.prisma.serviceRequest.findMany({ include: { service: true, user: { select: { id: true, email: true, displayName: true, phoneNumber: true } } }, orderBy: { createdAt: 'desc' } });
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
    await this.requireAdmin(adminId);
    const provider = await this.prisma.user.findUnique({ where: { id: dto.providerId }, select: { id: true, role: true } });
    if (!provider || provider.role !== UserRole.NURSE) throw new BadRequestException('The selected provider must have the NURSE role.');
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId }, include: { payments: true, onboarding: true } });
    if (!request) throw new NotFoundException('Service request not found.');
    if (!request.payments.some(payment => payment.status === PaymentStatus.VERIFIED)) throw new BadRequestException('A provider can only be assigned after payment verification.');
    if (!request.onboarding) throw new BadRequestException('Care onboarding must be completed before provider assignment.');
    return this.prisma.serviceRequest.update({ where: { id: requestId }, data: { assignedProviderId: provider.id, status: ServiceRequestStatus.ASSIGNED }, include: { assignedProvider: { select: { id: true, displayName: true } }, service: true } });
  }
  async listCategories() { return this.prisma.productCategory.findMany({ orderBy: { name: 'asc' } }); }
  async createCategory(userId: string, dto: CreateCategoryDto) {
    await this.requireAdmin(userId);
    return this.prisma.productCategory.create({ data: dto });
  }
  async listProducts(categoryId?: string) {
    return this.prisma.product.findMany({
      where: { status: ContentStatus.PUBLISHED, ...(categoryId ? { categoryId } : {}) },
      include: { category: true, variants: { where: { isAvailable: true }, select: { id: true, name: true, size: true, colour: true, stock: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createProduct(userId: string, dto: CreateProductDto) {
    await this.requireAdmin(userId);
    const category = await this.prisma.productCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('Category not found.');
    return this.prisma.product.create({ data: { ...dto, images: (dto.images ?? []) as any, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateProductStock(userId: string, productId: string, stock: number) {
    await this.requireAdmin(userId);
    if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException('Stock must be a non-negative integer.');
    return this.prisma.product.update({ where: { id: productId }, data: { stock } });
  }
  async updateProduct(userId: string, id: string, dto: UpdateProductDto) {
    await this.requireAdmin(userId);
    if (!(await this.prisma.product.findUnique({ where: { id } }))) throw new NotFoundException('Product not found.');
    if (dto.categoryId && !(await this.prisma.productCategory.findUnique({ where: { id: dto.categoryId } }))) throw new NotFoundException('Category not found.');
    return this.prisma.product.update({ where: { id }, data: { ...dto, ...(dto.images ? { images: dto.images as any } : {}) } });
  }
  async createVariant(userId: string, dto: CreateVariantDto) {
    await this.requireAdmin(userId);
    if (!(await this.prisma.product.findUnique({ where: { id: dto.productId } }))) throw new NotFoundException('Product not found.');
    return this.prisma.productVariant.create({ data: { ...dto, stock: dto.stock ?? 0, isAvailable: (dto.stock ?? 0) > 0 } });
  }
  async updateStock(userId: string, variantId: string, stock: number) {
    await this.requireAdmin(userId);
    if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException('Stock must be a non-negative integer.');
    return this.prisma.productVariant.update({ where: { id: variantId }, data: { stock, isAvailable: stock > 0 } });
  }
  async createOrder(userId: string, dto: CreateOrderDto) {
    await this.requireUser(userId);
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
          reference: this.ref('ORD'), userId, status: OrderStatus.PENDING_PAYMENT,
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
    await this.requireStaff(userId);
    return this.prisma.order.findMany({ include: { items: true, user: { select: { id: true, email: true, displayName: true } } }, orderBy: { createdAt: 'desc' } });
  }
  async updateOrderStatus(userId: string, id: string, dto: UpdateStatusDto) {
    await this.requireStaff(userId);
    if (!Object.values(OrderStatus).includes(dto.status as OrderStatus)) throw new BadRequestException('Invalid order status.');
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    const nextStatus = dto.status as OrderStatus;
    if (nextStatus === OrderStatus.REFUNDED) throw new BadRequestException('Use the payment refund workflow; order status cannot independently mark a refund.');
    if (order.status === OrderStatus.PENDING_PAYMENT && nextStatus !== OrderStatus.CANCELLED) throw new BadRequestException('An unpaid order cannot move to fulfilment.');
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) throw new BadRequestException('This order is already closed.');
    if (nextStatus === OrderStatus.CANCELLED) {
      await this.prisma.$transaction(async tx => {
        const changed = await tx.order.updateMany({ where: { id, status: order.status }, data: { status: OrderStatus.CANCELLED } });
        if (changed.count !== 1) throw new BadRequestException('Order status changed; reload and try again.');
        const items = await tx.orderItem.findMany({ where: { orderId: id, variantId: { not: null } } });
        for (const item of items) {
          if (item.variantId) await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity }, isAvailable: true } });
          else await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        }
      });
      return this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    }
    return this.prisma.order.update({ where: { id }, data: { status: nextStatus } });
  }

  async listEbooks() { return this.prisma.ebook.findMany({ where: { status: ContentStatus.PUBLISHED }, select: { id: true, slug: true, title: true, description: true, author: true, priceKobo: true, priceLabel: true, isIndicative: true, currency: true, coverImage: true, isDemo: true } }); }
  async createEbook(userId: string, dto: CreateEbookDto) {
    await this.requireAdmin(userId);
    return this.prisma.ebook.create({ data: { ...dto, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateEbook(userId: string, id: string, dto: UpdateEbookDto) {
    await this.requireAdmin(userId);
    if (!(await this.prisma.ebook.findUnique({ where: { id } }))) throw new NotFoundException('E-book not found.');
    return this.prisma.ebook.update({ where: { id }, data: dto });
  }
  async listCohorts() { return this.prisma.elevateCohort.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: { startsAt: 'asc' } }); }
  async createCohort(userId: string, dto: CreateCohortDto) {
    await this.requireAdmin(userId);
    if (dto.capacity && dto.capacity < 1) throw new BadRequestException('Capacity must be positive.');
    return this.prisma.elevateCohort.create({ data: { ...dto, learningOutcomes: dto.learningOutcomes, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async updateCohort(userId: string, id: string, dto: UpdateCohortDto) {
    await this.requireAdmin(userId);
    if (!(await this.prisma.elevateCohort.findUnique({ where: { id } }))) throw new NotFoundException('Cohort not found.');
    if (dto.capacity !== undefined) {
      const cohort = await this.prisma.elevateCohort.findUnique({ where: { id }, select: { enrolledCount: true } });
      if (cohort && dto.capacity < cohort.enrolledCount) throw new BadRequestException('Capacity cannot be lower than current enrolments.');
    }
    return this.prisma.elevateCohort.update({ where: { id }, data: {
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      learningOutcomes: dto.learningOutcomes as any,
    } });
  }
  async myLibrary(userId: string) {
    await this.requireUser(userId);
    const [ebooks, cohorts] = await Promise.all([
      this.prisma.entitlement.findMany({ where: { userId, type: EntitlementType.EBOOK, revokedAt: null }, include: { ebook: { select: { id: true, title: true, description: true, coverImage: true } } } }),
      this.prisma.entitlement.findMany({ where: { userId, type: EntitlementType.ELEVATE_COHORT, revokedAt: null }, include: { cohort: { select: { id: true, title: true, overview: true, startsAt: true, endsAt: true } } } }),
    ]);
    return { ebooks: ebooks.map(x => x.ebook).filter(Boolean), cohorts: cohorts.map(x => x.cohort).filter(Boolean) };
  }
  async joinCommunity(userId: string) {
    await this.requireUser(userId);
    return this.prisma.communityMembership.upsert({ where: { userId }, create: { userId }, update: {} });
  }
  async communityResources() {
    const [resources, announcements] = await Promise.all([
      this.prisma.communityResource.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: { createdAt: 'desc' } }),
      this.prisma.announcement.findMany({ where: { status: ContentStatus.PUBLISHED }, orderBy: { publishedAt: 'desc' } }),
    ]);
    return { resources, announcements };
  }
  async createCommunityResource(userId: string, dto: CreateCommunityResourceDto) {
    await this.requireAdmin(userId);
    return this.prisma.communityResource.create({ data: { ...dto, status: dto.status ?? ContentStatus.DRAFT } });
  }
  async createAnnouncement(userId: string, dto: CreateAnnouncementDto) {
    await this.requireAdmin(userId);
    const status = dto.status ?? ContentStatus.DRAFT;
    return this.prisma.announcement.create({ data: { ...dto, status, publishedAt: status === ContentStatus.PUBLISHED ? new Date() : undefined } });
  }
  async adminDashboard(userId: string) {
    await this.requireAdmin(userId);
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
    await this.requireStaff(userId);
    return this.prisma.payment.findMany({ include: { user: { select: { id: true, email: true, displayName: true } }, order: { select: { reference: true, status: true } }, serviceRequest: { select: { reference: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  async createSupportTicket(userId: string, dto: CreateSupportTicketDto) {
    await this.requireUser(userId);
    return this.prisma.supportTicket.create({ data: { reference: this.ref('SUP'), userId, ...dto } });
  }
  async mySupportTickets(userId: string) {
    await this.requireUser(userId);
    return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }
  async listSupportTickets(userId: string) {
    await this.requireStaff(userId);
    return this.prisma.supportTicket.findMany({ include: { user: { select: { id: true, email: true, displayName: true } } }, orderBy: { createdAt: 'desc' } });
  }
  async updateSupportTicket(userId: string, id: string, dto: UpdateStatusDto) {
    await this.requireStaff(userId);
    if (!Object.values(SupportStatus).includes(dto.status as SupportStatus)) throw new BadRequestException('Invalid support ticket status.');
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
    if (!user.email) throw new BadRequestException('An email address is required to make a payment.');
    let amountKobo = 0, orderId: string|undefined, serviceRequestId: string|undefined, ebookId: string|undefined, cohortId: string|undefined;
    switch (dto.purchaseType) {
      case PurchaseType.SHOP_ORDER: {
        const order = await this.prisma.order.findFirst({ where: { id: dto.targetId, userId } });
        if (!order) throw new NotFoundException('Order not found.');
        if (order.status !== OrderStatus.PENDING_PAYMENT) throw new BadRequestException('This order is not awaiting payment.');
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
        if (cohort.capacity && cohort.enrolledCount >= cohort.capacity) throw new BadRequestException('This cohort is full.');
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
    const reference = `GIL-${randomBytes(18).toString('hex')}`;
    let payment: any;
    try {
      payment = await this.prisma.payment.create({ data: { reference, activeKey, userId, purchaseType: dto.purchaseType, amountKobo, currency: 'NGN', status: PaymentStatus.INITIALIZED, orderId, serviceRequestId, ebookId, cohortId } });
    } catch (error) {
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
        callback_url: this.config.get<string>('PAYSTACK_CALLBACK_URL'),
        metadata: { paymentId: payment.id, userId, purchaseType: dto.purchaseType, targetId: dto.targetId },
      });
      return await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PENDING, paystackAccessCode: gateway.access_code, authorizationUrl: gateway.authorization_url }, select: { id: true, reference: true, amountKobo: true, currency: true, status: true, authorizationUrl: true, paystackAccessCode: true } });
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, activeKey: null } });
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
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment reference not found.');
    if (payment.status === PaymentStatus.VERIFIED) return { status: 'success', message: 'Payment already verified.', reference };
    if (payment.status === PaymentStatus.REFUNDED || payment.status === PaymentStatus.REFUND_PENDING) throw new BadRequestException('This payment is being refunded or has already been refunded.');
    const gateway = await this.paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, 'GET') as any;
    if (gateway.status !== 'success' || gateway.reference !== reference || gateway.amount !== payment.amountKobo || gateway.currency !== payment.currency) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, activeKey: null, gatewayResponse: gateway } });
      throw new BadRequestException('Paystack transaction did not match the expected amount, currency, reference, or successful status.');
    }
    await this.prisma.$transaction(async tx => {
      const locked = await tx.payment.findUnique({ where: { id: payment.id } });
      if (!locked) throw new NotFoundException('Payment not found.');
      if (locked.status === PaymentStatus.VERIFIED) return;
      const markedVerified = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentStatus.VERIFIED } },
        data: { status: PaymentStatus.VERIFIED, activeKey: null, verifiedAt: new Date(), paidAt: gateway.paid_at ? new Date(gateway.paid_at) : new Date(), paystackTransactionId: String(gateway.id), gatewayResponse: gateway },
      });
      if (markedVerified.count !== 1) return;
      if (payment.orderId) await tx.order.update({ where: { id: payment.orderId }, data: { status: OrderStatus.PAID } });
      if (payment.serviceRequestId) await tx.serviceRequest.update({ where: { id: payment.serviceRequestId }, data: { status: ServiceRequestStatus.PAID } });
      if (payment.ebookId) {
        await tx.learningPurchase.upsert({ where: { userId_ebookId: { userId: payment.userId, ebookId: payment.ebookId } }, create: { userId: payment.userId, ebookId: payment.ebookId, paymentId: payment.id }, update: { paymentId: payment.id } });
        const existingEntitlement = await tx.entitlement.findFirst({ where: { userId: payment.userId, type: EntitlementType.EBOOK, ebookId: payment.ebookId, revokedAt: null } });
        if (!existingEntitlement) await tx.entitlement.create({ data: { userId: payment.userId, type: EntitlementType.EBOOK, ebookId: payment.ebookId } });
      }
      if (payment.cohortId) {
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
  async refundPayment(adminId: string, reference: string, reason?: string) {
    await this.requireAdmin(adminId);
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== PaymentStatus.VERIFIED || !payment.paystackTransactionId) throw new BadRequestException('Only verified Paystack payments can be refunded.');
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
          await tx.cohortEnrollment.updateMany({ where: { userId: payment.userId, cohortId: payment.cohortId, status: 'ACTIVE' }, data: { status: 'REFUNDED' } });
          await tx.elevateCohort.updateMany({ where: { id: payment.cohortId, enrolledCount: { gt: 0 } }, data: { enrolledCount: { decrement: 1 } } });
        }
      });
      return { status: PaymentStatus.REFUNDED, reference, gatewayStatus: status };
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUND_PENDING, gatewayResponse: gateway } });
    return { status: PaymentStatus.REFUND_PENDING, reference, gatewayStatus: status, message: 'Paystack has accepted the refund request; final settlement is not yet confirmed.' };
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
