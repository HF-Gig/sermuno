import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import type { FeatureFlags } from '../../config/feature-flags.service';

@UseGuards(JwtAuthGuard)
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /** GET /feature-flags — returns current state of all feature flags */
  @Get()
  getAll(): FeatureFlags {
    return this.flags.getAll();
  }

  /** PATCH /feature-flags — toggle one or more feature flags in-memory */
  @Patch()
  patch(
    @Body() updates: Partial<Record<keyof FeatureFlags, boolean>>,
  ): FeatureFlags {
    return this.flags.patch(updates);
  }
}
