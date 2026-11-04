# Turnstile application backend

Follow the root workspace standards. NestJS uses Fastify and Biome.
Onboarding follows the accepted [specification](../../docs/turnstile/onboarding/onboarding_specification.md)
and [delivery plan](../../docs/turnstile/onboarding/onboarding_implementation_plan.md). Other business
functionality needs its own specification; do not invent business modules.
Integrate with the DMS through its HTTP API, never through DMS source files or tables.
Use the installed Nest CLI to generate additional modules, controllers, and providers.
