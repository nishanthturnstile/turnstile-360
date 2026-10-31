import { Controller, Post, Req, Res } from '@nestjs/common';
import { enrollmentResponseSchema } from '@thaarei/dms-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PendingEnrollment } from '../access/access-policy.js';
import { EnrollmentService } from './enrollment.service.js';

@Controller('application-enrollments')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}
  @Post()
  @PendingEnrollment()
  async enroll(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.enrollment.enroll(request);
    reply.code(result.replay ? 200 : 201);
    return enrollmentResponseSchema.parse(result.response);
  }
}
