import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const products = [
  {
    sku: "MUG-STN-001",
    name: "Harbour Stoneware Mug",
    description: "A sturdy blue-glazed mug for tea after a windy pier walk.",
    category: "home",
    pricePence: 1800
  },
  {
    sku: "BAG-CNV-002",
    name: "Canvas Beach Market Tote",
    description: "A heavyweight cotton tote for towels, paperbacks, and market finds.",
    category: "bags",
    pricePence: 2400
  },
  {
    sku: "TEA-BLK-003",
    name: "Pier Breakfast Tea Tin",
    description: "Loose-leaf black tea in a reusable tin for brisk seaside mornings.",
    category: "pantry",
    pricePence: 1250
  }
];

const users = [
  {
    email: "manager@example.com",
    name: "Shop Manager",
    role: "shop-manager",
    password: "manager-password"
  },
  {
    email: "customer@example.com",
    name: "Demo Customer",
    role: "customer",
    password: "customer-password"
  }
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: product,
      create: product
    });
  }

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 12);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        passwordHash
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
