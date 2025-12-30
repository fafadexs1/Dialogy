import { PrismaClient } from '@prisma/client';
import { PLANS } from '../src/lib/plans-types';

const prisma = new PrismaClient() as any;

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
