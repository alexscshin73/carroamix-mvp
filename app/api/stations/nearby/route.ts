import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(req: Request) {

  const { searchParams } = new URL(req.url)

  const lat = Number(searchParams.get("lat"))
  const lng = Number(searchParams.get("lng"))

  const radius = Number(searchParams.get("radius") ?? "5")
  const limit = Number(searchParams.get("limit") ?? "50")

  if (!lat || !lng) {
    return NextResponse.json(
      { error: "lat lng required" },
      { status: 400 }
    )
  }

  const { data, error } = await supabase.rpc("nearby_magno", {
    in_lat: lat,
    in_lng: lng,
    radius_km: radius,
    limit_n: limit
  })

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json(data)
}