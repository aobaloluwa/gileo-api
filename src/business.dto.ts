import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateServiceDto {
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsString() @MinLength(2) @MaxLength(120) slug!: string;
  @IsString() @MinLength(5) description!: string;
  @IsOptional() @IsString() audience?: string;
  @IsOptional() @IsString() whatIsIncluded?: string;
  @IsOptional() @IsInt() @Min(0) priceKobo?: number;
  @IsOptional() @IsString() priceLabel?: string;
  @IsOptional() @IsBoolean() isIndicative?: boolean;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class CreateServiceRequestDto {
  @IsUUID() serviceId!: string;
  @IsOptional() @IsDateString() preferredDate?: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsString() @MaxLength(2000) customerNote?: string;
}
export class CreateCategoryDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(2) @MaxLength(120) slug!: string;
  @IsOptional() @IsString() description?: string;
}
export class CreateProductDto {
  @IsUUID() categoryId!: string;
  @IsString() @MinLength(2) @MaxLength(160) slug!: string;
  @IsString() @MinLength(2) @MaxLength(180) title!: string;
  @IsString() @MinLength(5) description!: string;
  @IsInt() @Min(0) priceKobo!: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) stock?: number;
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsBoolean() isDemo?: boolean;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class CreateVariantDto {
  @IsUUID() productId!: string;
  @IsString() @MinLength(2) @MaxLength(100) sku!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() colour?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) stock?: number;
}
export class CreateOrderItemDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsInt() @Min(1) @Max(100) quantity!: number;
}
export class CreateOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
  @IsOptional() @IsObject() shippingAddress?: Record<string, unknown>;
}
export class InitializePaymentDto {
  @IsIn(['SHOP_ORDER','SERVICE_REQUEST','EBOOK','ELEVATE_COHORT']) purchaseType!: 'SHOP_ORDER'|'SERVICE_REQUEST'|'EBOOK'|'ELEVATE_COHORT';
  @IsUUID() targetId!: string;
}
export class CreateEbookDto {
  @IsString() @MinLength(2) @MaxLength(160) slug!: string;
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(5) description!: string;
  @IsOptional() @IsString() author?: string;
  @IsInt() @Min(0) priceKobo!: number;
  @IsOptional() @IsString() @MaxLength(120) priceLabel?: string;
  @IsOptional() @IsBoolean() isIndicative?: boolean;
  @IsOptional() @IsString() coverImage?: string;
  @IsOptional() @IsString() fileKey?: string;
  @IsOptional() @IsBoolean() isDemo?: boolean;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class CreateCohortDto {
  @IsString() @MinLength(2) @MaxLength(160) slug!: string;
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(5) overview!: string;
  @IsArray() learningOutcomes!: string[];
  @IsOptional() @IsString() eligibility?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() schedule?: string;
  @IsInt() @Min(0) priceKobo!: number;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class CreateSupportTicketDto {
  @IsString() @MinLength(2) @MaxLength(60) category!: string;
  @IsString() @MinLength(2) @MaxLength(180) subject!: string;
  @IsString() @MinLength(5) @MaxLength(4000) message!: string;
}
export class UpdateStatusDto {
  @IsString() @MinLength(2) status!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CreateCommunityResourceDto {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(2) @MaxLength(160) slug!: string;
  @IsString() @MinLength(5) description!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() resourceUrl?: string;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class CreateAnnouncementDto {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(2) @MaxLength(160) slug!: string;
  @IsString() @MinLength(5) body!: string;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}

export class UpdateUserRoleDto {
  @IsIn(['CUSTOMER','COMMUNITY_MEMBER','ELEVATE_PARTICIPANT','SUPPORT','ADMIN']) role!: 'CUSTOMER'|'COMMUNITY_MEMBER'|'ELEVATE_PARTICIPANT'|'SUPPORT'|'ADMIN';
}

export class UpdateProductDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MinLength(5) description?: string;
  @IsOptional() @IsInt() @Min(0) priceKobo?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) stock?: number;
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsBoolean() isDemo?: boolean;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class UpdateServiceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MinLength(5) description?: string;
  @IsOptional() @IsString() audience?: string;
  @IsOptional() @IsString() whatIsIncluded?: string;
  @IsOptional() @IsInt() @Min(0) priceKobo?: number;
  @IsOptional() @IsString() priceLabel?: string;
  @IsOptional() @IsBoolean() isIndicative?: boolean;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}
export class UpdateEbookDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(5) description?: string;
  @IsOptional() @IsString() author?: string;
  @IsOptional() @IsInt() @Min(0) priceKobo?: number;
  @IsOptional() @IsString() @MaxLength(120) priceLabel?: string;
  @IsOptional() @IsBoolean() isIndicative?: boolean;
  @IsOptional() @IsString() coverImage?: string;
  @IsOptional() @IsString() fileKey?: string;
  @IsOptional() @IsBoolean() isDemo?: boolean;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}

export class UpdateCohortDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(5) overview?: string;
  @IsOptional() @IsArray() learningOutcomes?: string[];
  @IsOptional() @IsString() eligibility?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() schedule?: string;
  @IsOptional() @IsInt() @Min(0) priceKobo?: number;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(['DRAFT','PUBLISHED','ARCHIVED']) status?: 'DRAFT'|'PUBLISHED'|'ARCHIVED';
}

export class CareOnboardingDto {
  @IsUUID() serviceRequestId!: string;
  @IsString() @MinLength(2) @MaxLength(160) patientName!: string;
  @IsString() @MinLength(7) @MaxLength(30) contactPhone!: string;
  @IsString() @MinLength(2) @MaxLength(160) emergencyContactName!: string;
  @IsString() @MinLength(7) @MaxLength(30) emergencyContactPhone!: string;
  @IsOptional() @IsString() @MaxLength(3000) careNotes?: string;
  @IsBoolean() consentToCareData!: boolean;
}
export class AssignProviderDto {
  @IsUUID() providerId!: string;
}
