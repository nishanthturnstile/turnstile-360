import { Controller, Post, Req, Res } from '@nestjs/common';
import { enrollmentResponseSchema } from '@thaarei/dms-contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DmsOperation } from '../access/dms-operation.js';
import { EnrollmentService } from './enrollment.service.js';

@Controller('application-enrollments')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}
  @Post()
  @DmsOperation('enrollDmsApplication')
  async enroll(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.enrollment.enroll(request);
    reply.code(result.replay ? 200 : 201);
    return enrollmentResponseSchema.parse(result.response);
  }
}
