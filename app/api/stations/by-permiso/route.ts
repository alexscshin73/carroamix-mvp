import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const permiso = searchParams.get('permiso')

  if (!permiso) return NextResponse.json({ error: 'permiso required' }, { status: 400 })

  const { data: station, error: sErr } = await supabase
    .from('stations')
    .select('permiso,nombre,direccion,lat,lng,brand_key')
    .eq('permiso', permiso)
    .maybeSingle()

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!station) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: prices, error: pErr } = await supabase
    .from('latest_prices')
    .select('producto,subproducto,precio,moneda,fetched_at')
    .eq('station_permiso', permiso)

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  return NextResponse.json({ station, prices: prices ?? [] })
}