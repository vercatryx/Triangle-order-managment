import { NextResponse } from 'next/server';
import { getVendors, getMenuItems, getMealCategories, getMealItems, getCategories } from '@/lib/actions';

export async function GET() {
  try {
    const [vendors, menuItems, mealCategories, mealItems, categories] = await Promise.all([
      getVendors(),
      getMenuItems({ includeInactive: true }),
      getMealCategories(),
      getMealItems(),
      getCategories({ includeInactive: true })
    ]);
    return NextResponse.json({
      vendors: vendors || [],
      menuItems: menuItems || [],
      mealCategories: mealCategories || [],
      mealItems: mealItems || [],
      categories: categories || []
    });
  } catch (e) {
    console.error('[missing-orders/reference-data]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
