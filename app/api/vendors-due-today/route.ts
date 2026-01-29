import { NextRequest, NextResponse } from 'next/server';
import { getVendorsWithTodaysDeliveries } from '@/lib/actions';
import { Vendor } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const vendors: Vendor[] = await getVendorsWithTodaysDeliveries();
    return NextResponse.json(vendors);
  } catch (error) {
    console.error('Error fetching vendors with todays deliveries:', error);
    return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
  }
}
