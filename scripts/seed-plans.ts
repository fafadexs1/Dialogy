import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PLANS } from '../src/lib/plans-types';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed plans.');
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
}) as any;

async function main() {
    console.log('Seeding plans...');

    for (const key in PLANS) {
        const plan = PLANS[key as keyof typeof PLANS];
        console.log(`Upserting plan: ${plan.label}`);

        await prisma.plan.upsert({
            where: { slug: plan.id },
            update: {
                name: plan.label,
                price: plan.price,
                limits: plan.limits as any,
                stripe_price_id: plan.stripePriceId || null,
            },
            create: {
                slug: plan.id,
                name: plan.label,
                description: `Plan ${plan.label}`,
                price: plan.price,
                limits: plan.limits as any,
                stripe_price_id: plan.stripePriceId || null,
                is_active: true,
                is_default: plan.id === 'starter',
            },
        });
    }

    console.log('Plans seeded successfully!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
