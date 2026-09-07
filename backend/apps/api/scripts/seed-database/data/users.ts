import { type CreateUserDto } from '@ci/domains/user';

type SeedUser = Optional<RequiredFields<CreateUserDto, 'id'>, 'password'>;

// The single id every seeder writes under. `data/hbpe.ts` derives HBPE_USER_ID
// from it and the other seeders read `JOHN_SMITH.id` directly, so overriding
// SEED_USER_ID retargets the whole demo dataset at one existing account
// instead of creating John Smith.
//
// seedUsers() skips creation when the id already exists, so a real account
// keeps its own name, email and password — the fields below apply only when
// the seed is creating the user from scratch.
export const SEED_USER_ID = process.env.SEED_USER_ID || 'b3b8c7e2-1c2d-4e5f-8a6b-9c0d1e2f3a4b';

export const JOHN_SMITH: SeedUser = {
  id: SEED_USER_ID,
  name: 'John Smith',
  email: process.env.AUTH_DEFAULT_USER_EMAIL || 'jsmith@example.com',
  password: process.env.AUTH_DEFAULT_USER_PASSWORD,
};
