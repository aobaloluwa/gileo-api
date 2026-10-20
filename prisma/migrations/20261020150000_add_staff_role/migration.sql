-- Add a general staff role without removing existing specialist roles.
-- PostgreSQL enum values are additive and preserve existing user assignments.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STAFF';
