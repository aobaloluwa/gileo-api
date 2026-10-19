import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from './auth/guards/jwt-auth/jwt-auth.guard';
import { BusinessService } from './business.service';
import {
  AssignProviderDto, CareOnboardingDto, CreateAnnouncementDto, CreateCategoryDto, CreateCohortDto, CreateCommunityResourceDto, CreateEbookDto, CreateOrderDto,
  CreateProductDto, CreateServiceDto, CreateServiceRequestDto,
  CreateSupportTicketDto, CreateVariantDto, InitializePaymentDto, UpdateCohortDto, UpdateEbookDto, UpdateProductDto, UpdateServiceDto, UpdateStatusDto, UpdateUserRoleDto,
} from './business.dto';

interface AuthRequest extends Request { user: { userId: string } }
@ApiTags('GILEO Business')
@Controller()
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get('profile/me') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  myProfile(@Req() r: AuthRequest) { return this.business.myProfile(r.user.userId); }
  @Patch('admin/users/:id/role') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateUserRole(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateUserRoleDto) { return this.business.updateUserRole(r.user.userId, id, dto); }

  @Get('services') @ApiOperation({ summary: 'List published healthcare services' })
  listServices() { return this.business.listServices(); }
  @Patch('services/:id') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateService(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateServiceDto) { return this.business.updateService(r.user.userId, id, dto); }
  @Post('services') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createService(@Req() r: AuthRequest, @Body() dto: CreateServiceDto) { return this.business.createService(r.user.userId, dto); }
  @Post('service-requests') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createServiceRequest(@Req() r: AuthRequest, @Body() dto: CreateServiceRequestDto) { return this.business.createServiceRequest(r.user.userId, dto); }
  @Get('service-requests/mine') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  myServiceRequests(@Req() r: AuthRequest) { return this.business.listMyServiceRequests(r.user.userId); }
  @Get('service-requests') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  allServiceRequests(@Req() r: AuthRequest) { return this.business.listAllServiceRequests(r.user.userId); }
  @Patch('service-requests/:id/status') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateServiceRequest(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateStatusDto) { return this.business.updateServiceStatus(r.user.userId, id, dto); }

  @Post('service-requests/onboarding') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createCareOnboarding(@Req() r: AuthRequest, @Body() dto: CareOnboardingDto) { return this.business.createCareOnboarding(r.user.userId, dto); }
  @Get('service-requests/:id/onboarding') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  getCareOnboarding(@Req() r: AuthRequest, @Param('id') id: string) { return this.business.getCareOnboarding(r.user.userId, id); }
  @Post('service-requests/:id/assign-provider') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  assignProvider(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: AssignProviderDto) { return this.business.assignProvider(r.user.userId, id, dto); }

  @Get('shop/categories') listCategories() { return this.business.listCategories(); }
  @Post('shop/categories') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createCategory(@Req() r: AuthRequest, @Body() dto: CreateCategoryDto) { return this.business.createCategory(r.user.userId, dto); }
  @Get('shop/products') listProducts(@Query('categoryId') categoryId?: string) { return this.business.listProducts(categoryId); }
  @Post('shop/products') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createProduct(@Req() r: AuthRequest, @Body() dto: CreateProductDto) { return this.business.createProduct(r.user.userId, dto); }
  @Patch('shop/products/:id/stock') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateProductStock(@Req() r: AuthRequest, @Param('id') id: string, @Body('stock') stock: number) { return this.business.updateProductStock(r.user.userId, id, stock); }
  @Patch('shop/products/:id') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateProduct(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateProductDto) { return this.business.updateProduct(r.user.userId, id, dto); }
  @Post('shop/variants') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createVariant(@Req() r: AuthRequest, @Body() dto: CreateVariantDto) { return this.business.createVariant(r.user.userId, dto); }
  @Patch('shop/variants/:id/stock') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateStock(@Req() r: AuthRequest, @Param('id') id: string, @Body('stock') stock: number) { return this.business.updateStock(r.user.userId, id, stock); }
  @Post('shop/orders') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createOrder(@Req() r: AuthRequest, @Body() dto: CreateOrderDto) { return this.business.createOrder(r.user.userId, dto); }
  @Get('shop/orders/mine') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  myOrders(@Req() r: AuthRequest) { return this.business.listMyOrders(r.user.userId); }
  @Get('shop/orders') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  allOrders(@Req() r: AuthRequest) { return this.business.listAllOrders(r.user.userId); }
  @Patch('shop/orders/:id/status') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateOrder(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateStatusDto) { return this.business.updateOrderStatus(r.user.userId, id, dto); }

  @Get('learning/ebooks') listEbooks() { return this.business.listEbooks(); }
  @Post('learning/ebooks') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createEbook(@Req() r: AuthRequest, @Body() dto: CreateEbookDto) { return this.business.createEbook(r.user.userId, dto); }
  @Patch('learning/ebooks/:id') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateEbook(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateEbookDto) { return this.business.updateEbook(r.user.userId, id, dto); }
  @Get('learning/cohorts') listCohorts() { return this.business.listCohorts(); }
  @Post('learning/cohorts') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createCohort(@Req() r: AuthRequest, @Body() dto: CreateCohortDto) { return this.business.createCohort(r.user.userId, dto); }
  @Patch('learning/cohorts/:id') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateCohort(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateCohortDto) { return this.business.updateCohort(r.user.userId, id, dto); }
  @Get('learning/library') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  myLibrary(@Req() r: AuthRequest) { return this.business.myLibrary(r.user.userId); }
  @Post('community/resources') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createCommunityResource(@Req() r: AuthRequest, @Body() dto: CreateCommunityResourceDto) { return this.business.createCommunityResource(r.user.userId, dto); }
  @Post('community/announcements') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createAnnouncement(@Req() r: AuthRequest, @Body() dto: CreateAnnouncementDto) { return this.business.createAnnouncement(r.user.userId, dto); }
  @Post('community/join') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  joinCommunity(@Req() r: AuthRequest) { return this.business.joinCommunity(r.user.userId); }
  @Get('community/resources') communityResources() { return this.business.communityResources(); }

  @Post('support/tickets') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  createSupportTicket(@Req() r: AuthRequest, @Body() dto: CreateSupportTicketDto) { return this.business.createSupportTicket(r.user.userId, dto); }
  @Get('support/tickets/mine') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  myTickets(@Req() r: AuthRequest) { return this.business.mySupportTickets(r.user.userId); }
  @Get('support/tickets') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  allTickets(@Req() r: AuthRequest) { return this.business.listSupportTickets(r.user.userId); }
  @Patch('support/tickets/:id/status') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  updateTicket(@Req() r: AuthRequest, @Param('id') id: string, @Body() dto: UpdateStatusDto) { return this.business.updateSupportTicket(r.user.userId, id, dto); }

  @Get('admin/dashboard') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  adminDashboard(@Req() r: AuthRequest) { return this.business.adminDashboard(r.user.userId); }
  @Get('admin/payments') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  listPayments(@Req() r: AuthRequest) { return this.business.listPayments(r.user.userId); }

  @Post('admin/payments/:reference/refund') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  refundPayment(@Req() r: AuthRequest, @Param('reference') reference: string, @Body('reason') reason?: string) { return this.business.refundPayment(r.user.userId, reference, reason); }

  @Post('payments/initialize') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Initialize a Paystack transaction for an eligible purchase' })
  initializePayment(@Req() r: AuthRequest, @Body() dto: InitializePaymentDto) { return this.business.initializePayment(r.user.userId, dto); }
  @Post('payments/verify/:reference') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify a Paystack transaction server-side' })
  verifyPayment(@Req() r: AuthRequest, @Param('reference') reference: string) { return this.business.verifyPayment(r.user.userId, reference); }
  @Post('payments/paystack/webhook')
  @ApiOperation({ summary: 'Paystack webhook endpoint; validates x-paystack-signature' })
  async webhook(@Req() r: Request & { rawBody?: Buffer }, @Headers('x-paystack-signature') signature?: string) {
    if (!this.business.verifyPaystackSignature(r.rawBody, signature)) {
      const { UnauthorizedException } = await import('@nestjs/common');
      throw new UnauthorizedException('Invalid Paystack webhook signature.');
    }
    return this.business.handlePaystackWebhook(r.body);
  }
}
