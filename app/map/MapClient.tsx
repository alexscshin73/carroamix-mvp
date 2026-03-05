'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { supabase } from '../../lib/supabase'

type Bbox = { south: number; west: number; north: number; east: number; zoom: number }
type LatLng = { lat: number; lng: number }

type NearbyItem = {
  permiso: string
  nombre: string | null
  direccion: string | null
  lat: number
  lng: number
  magno_precio: number
  moneda: string
  brand_key: string | null
}

type BrandRow = { brand_key: string; brand_name: string; logo_url: string }

type StationDetail = {
  station: { permiso: string; nombre: string | null; direccion: string | null; brand_key: string | null }
  prices: { producto: string; subproducto: string; precio: number; moneda: string; fetched_at: string }[]
}

const LS_KEY = 'carroamix:last_location'
const DEFAULT_ZOOM = 15
const FALLBACK_CENTER: LatLng = { lat: 25.6866, lng: -100.3161 }

// =====================
// ICONS
// =====================
function makeDotIcon(size = 7, color = 'rgb(45,95,210)') {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:999px;transform:translate(-50%,-50%);"></div>`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}

function makePinIcon(size: 'sm' | 'md') {
  const w = size === 'sm' ? 22 : 28
  const h = size === 'sm' ? 30 : 38

  const html = `
  <div style="transform: translate(-50%, -100%);">
    <svg width="${w}" height="${h}" viewBox="0 0 64 82">
      <path
        d="M32 0C14 0 0 14 0 32C0 54 32 82 32 82C32 82 64 54 64 32C64 14 50 0 32 0Z"
        fill="rgb(45,95,210)"
      />
      <circle cx="32" cy="32" r="16" fill="white"/>
    </svg>
  </div>
  `
  return L.divIcon({
    className: '',
    html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h + 8],
  })
}

function makePricePinIcon(opts: { logoUrl?: string | null; price: number; size: 'sm' | 'lg'; showLogo: boolean }) {
  const priceText = Number.isFinite(opts.price) ? Number(opts.price).toFixed(2) : '--'

  const w = opts.size === 'sm' ? 34 : 44
  const h = opts.size === 'sm' ? 46 : 60

  const priceFont = opts.size === 'sm' ? 11 : 13
  const topPx = opts.size === 'sm' ? 11 : 15

  const logo = opts.logoUrl
    ? `<img src="${opts.logoUrl}" style="width:18px;height:18px;border-radius:999px;background:#fff;padding:2px;border:1px solid rgba(18,32,103,0.18);" />`
    : `<div style="width:18px;height:18px;border-radius:999px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;border:1px solid rgba(18,32,103,0.18);color:rgb(18,32,103);">⛽</div>`

  const html = `
  <div style="position:relative; transform: translate(-50%, -100%); font-family: ui-sans-serif, system-ui;">
    <svg width="${w}" height="${h}" viewBox="0 0 64 82">
      <path
        d="M32 0C14 0 0 14 0 32C0 54 32 82 32 82C32 82 64 54 64 32C64 14 50 0 32 0Z"
        fill="rgb(45,95,210)"
      />
      <circle cx="32" cy="32" r="16" fill="white"/>
    </svg>

    <div style="
      position:absolute;
      top:${topPx}px;
      left:50%;
      transform:translateX(-50%);
      display:flex;
      align-items:center;
      gap:6px;
    ">
      ${opts.showLogo ? logo : ''}

      <div style="
        font-weight:900;
        font-size:${priceFont}px;
        color:rgb(18,32,103);
        background:rgba(255,255,255,0.92);
        padding:4px 8px;
        border-radius:999px;
        border:1px solid rgba(18,32,103,0.18);
        box-shadow:0 6px 14px rgba(0,0,0,0.12);
      ">
        $${priceText}
      </div>
    </div>
  </div>
  `

  return L.divIcon({
    className: '',
    html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h + 8],
  })
}

// 검색 결과/선택 위치 표시용 “빨간 핀”
function makeSearchPinIcon() {
  const html = `
    <div style="transform: translate(-50%, -100%);">
      <svg width="28" height="38" viewBox="0 0 64 82">
        <path d="M32 0C14 0 0 14 0 32C0 54 32 82 32 82C32 82 64 54 64 32C64 14 50 0 32 0Z" fill="rgb(220,38,38)" />
        <circle cx="32" cy="32" r="16" fill="white"/>
        <circle cx="32" cy="32" r="6" fill="rgb(220,38,38)"/>
      </svg>
    </div>
  `
  return L.divIcon({
    className: '',
    html,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -30],
  })
}

// =====================
// MAP HELPERS
// =====================
function isUsableBbox(b: Bbox) {
  const latSpan = Math.abs(b.north - b.south)
  const lngSpan = Math.abs(b.east - b.west)
  return latSpan < 1.0 && lngSpan < 1.0
}

function isSameBbox(a: Bbox | null, b: Bbox, eps = 1e-6) {
  if (!a) return false
  return (
    a.zoom === b.zoom &&
    Math.abs(a.south - b.south) < eps &&
    Math.abs(a.west - b.west) < eps &&
    Math.abs(a.north - b.north) < eps &&
    Math.abs(a.east - b.east) < eps
  )
}

/** react-leaflet: 이 컴포넌트가 최초 1회 bbox를 올려줌 */
function BboxBinder(props: { onBbox: (b: Bbox) => void }) {
  const map = useMap()
  const lastRef = useRef<Bbox | null>(null)

  const push = useCallback(() => {
    const b = map.getBounds()
    const next: Bbox = {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
      zoom: map.getZoom(),
    }
    if (isSameBbox(lastRef.current, next)) return
    lastRef.current = next
    props.onBbox(next)
  }, [map, props])

  useEffect(() => {
    map.whenReady(() => {
      push()
      setTimeout(push, 150)
      setTimeout(push, 600)
    })
  }, [map, push])

  useMapEvents({
    load: () => push(),
    resize: () => push(),
    moveend: () => push(),
    zoomend: () => push(),
  })

  return null
}

/** 현재 위치 버튼(구글/네이버/카카오 스타일) */
function LocateControl(props: { myPos: LatLng | null }) {
  const map = useMap()

  return (
    <div style={{ position: 'absolute', right: 12, bottom: 96, zIndex: 1000 }}>
      <button
        type="button"
        onClick={() => {
          if (!props.myPos) return
          map.flyTo([props.myPos.lat, props.myPos.lng], Math.max(map.getZoom(), 16), { animate: true, duration: 0.8 })
        }}
        disabled={!props.myPos}
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          border: '1px solid rgba(0,0,0,0.12)',
          background: 'white',
          boxShadow: '0 6px 16px rgba(0,0,0,0.18)',
          cursor: props.myPos ? 'pointer' : 'not-allowed',
          display: 'grid',
          placeItems: 'center',
          opacity: props.myPos ? 1 : 0.5,
        }}
        aria-label="내 위치로 이동"
        title="내 위치로 이동"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="none" stroke="rgb(45,95,210)" strokeWidth="2" />
          <circle cx="12" cy="12" r="1.6" fill="rgb(45,95,210)" />
          <line x1="12" y1="2" x2="12" y2="5" stroke="rgb(45,95,210)" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="19" x2="12" y2="22" stroke="rgb(45,95,210)" strokeWidth="2" strokeLinecap="round" />
          <line x1="2" y1="12" x2="5" y2="12" stroke="rgb(45,95,210)" strokeWidth="2" strokeLinecap="round" />
          <line x1="19" y1="12" x2="22" y2="12" stroke="rgb(45,95,210)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

// =====================
// SEARCH (Google Maps style left panel)
// =====================
function SearchControl(props: { onPickPlace: (p: { name: string; lat: number; lng: number }) => void }) {
  const map = useMap()
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [items, setItems] = useState<{ display_name: string; lat: string; lon: string; type?: string }[]>([])
  const [open, setOpen] = useState(false)

  async function runSearch(query: string) {
    const text = query.trim()
    if (!text) {
      setItems([])
      setOpen(false)
      return
    }
    setLoading(true)
    setErr('')
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=json&limit=12&countrycodes=mx&q=` + encodeURIComponent(text)
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      const data = (await res.json()) as any[]
      const list = Array.isArray(data)
        ? data.map((x) => ({
            display_name: String(x.display_name ?? ''),
            lat: String(x.lat ?? ''),
            lon: String(x.lon ?? ''),
            type: String(x.type ?? ''),
          }))
        : []
      setItems(list)
      setOpen(true)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
      setItems([])
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  function pick(it: { display_name: string; lat: string; lon: string }) {
    const lat = Number(it.lat)
    const lng = Number(it.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    props.onPickPlace({ name: it.display_name, lat, lng })
    map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { animate: true, duration: 0.8 })
    setOpen(true)
  }

  useEffect(() => {
    const t = setTimeout(() => runSearch(q), 350)
    return () => clearTimeout(t)
  }, [q])

  return (
    <>
      {/* 검색바 */}
      <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 1200, width: 420, fontFamily: 'ui-sans-serif, system-ui' }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 18,
            padding: '10px 12px',
            boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ width: 34, height: 34, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 18 }}>☰</div>

          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setErr('')
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                if (items[0]) pick(items[0])
              }
            }}
            placeholder="gasolina / 주소 검색"
            style={{ flex: 1, outline: 'none', border: 'none', fontSize: 16, background: 'transparent' }}
          />

          <button
            type="button"
            onClick={() => runSearch(q)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              border: '1px solid rgba(0,0,0,0.10)',
              background: 'white',
              boxShadow: '0 6px 14px rgba(0,0,0,0.12)',
              cursor: 'pointer',
              fontSize: 18,
            }}
            aria-label="검색"
            title="검색"
          >
            🔍
          </button>

          <button
            type="button"
            onClick={() => {
              setQ('')
              setItems([])
              setOpen(false)
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              border: '1px solid rgba(0,0,0,0.10)',
              background: 'white',
              boxShadow: '0 6px 14px rgba(0,0,0,0.12)',
              cursor: 'pointer',
              fontSize: 18,
            }}
            aria-label="닫기"
            title="닫기"
          >
            ✕
          </button>
        </div>

        {err ? <div style={{ marginTop: 8, color: 'crimson', fontSize: 12 }}>{err}</div> : null}
      </div>

      {/* 좌측 결과 패널 */}
      {open ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 74,
            zIndex: 1150,
            width: 420,
            maxHeight: '78vh',
            background: 'rgba(255,255,255,0.94)',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 16px 34px rgba(0,0,0,0.22)',
            backdropFilter: 'blur(10px)',
            fontFamily: 'ui-sans-serif, system-ui',
          }}
        >
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 900, fontSize: 14 }}>Results</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{loading ? 'cargando...' : `${items.length} items`}</div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }} />

          <div style={{ overflowY: 'auto', maxHeight: 'calc(78vh - 52px)' }}>
            {items.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 13, opacity: 0.75 }}>{loading ? '검색중...' : '검색 결과 없음'}</div>
            ) : (
              items.map((it, idx) => (
                <button
                  key={`${it.lat}-${it.lon}-${idx}`}
                  type="button"
                  onClick={() => pick(it)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderTop: idx === 0 ? 'none' : '1px solid rgba(0,0,0,0.08)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 12,
                        background: 'rgba(45,95,210,0.10)',
                        color: 'rgb(45,95,210)',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 900,
                      }}
                    >
                      {idx + 1}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 900, fontSize: 13, color: 'rgb(18,32,103)' }}>{it.display_name.split(',')[0]}</div>
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75, lineHeight: 1.35 }}>{it.display_name}</div>

                      <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                        <span
                          style={{
                            fontSize: 12,
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '1px solid rgba(0,0,0,0.10)',
                            background: 'white',
                          }}
                        >
                          📍 Ver en mapa
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}

            <div style={{ padding: '10px 14px', fontSize: 11, opacity: 0.6, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              datos: OpenStreetMap (Nominatim)
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// =====================
// POPUP
// =====================
function pickFuel(prices: StationDetail['prices']) {
  const list = (prices ?? []).map((p) => ({
    key: `${(p.producto ?? '').toLowerCase()} ${(p.subproducto ?? '').toLowerCase()}`,
    precio: Number(p.precio),
    moneda: p.moneda ?? 'MXN',
  }))

  const magno = list.find((x) => x.key.includes('regular') || x.key.includes('magna') || x.key.includes('magno'))
  const premium = list.find((x) => x.key.includes('premium'))
  const diesel = list.find((x) => x.key.includes('diesel') || x.key.includes('diésel'))

  return { magno, premium, diesel }
}

function StationPopup(props: { permiso: string; fallbackName: string; fallbackAddress: string }) {
  const [detail, setDetail] = useState<StationDetail | null>(null)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setErr('')
        const res = await fetch(`/api/stations/by-permiso?permiso=${encodeURIComponent(props.permiso)}`)
        const data = await res.json()
        if (cancelled) return
        setDetail(data)
      } catch (e: any) {
        if (cancelled) return
        setErr(e?.message ?? String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.permiso])

  const name = detail?.station?.nombre ?? props.fallbackName ?? 'Gasolinera'
  const addr = detail?.station?.direccion ?? props.fallbackAddress ?? ''
  const { magno, premium, diesel } = pickFuel(detail?.prices ?? [])

  return (
    <div style={{ minWidth: 240, fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ fontWeight: 900 }}>{name}</div>
      {addr ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{addr}</div> : null}

      <div style={{ marginTop: 10 }}>
        Magno: <b>{magno ? magno.precio.toFixed(2) : '--'}</b> {magno ? magno.moneda : 'MXN'}
      </div>
      <div style={{ marginTop: 4 }}>
        Premium: <b>{premium ? premium.precio.toFixed(2) : '--'}</b> {premium ? premium.moneda : 'MXN'}
      </div>
      <div style={{ marginTop: 4 }}>
        Diesel: <b>{diesel ? diesel.precio.toFixed(2) : 'X'}</b> {diesel ? diesel.moneda : ''}
      </div>

      {err ? <div style={{ marginTop: 8, color: 'crimson', fontSize: 12 }}>{err}</div> : null}

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>permiso: {props.permiso}</div>
    </div>
  )
}

// =====================
// MAIN
// =====================
export default function MapClient() {
  const [initialView, setInitialView] = useState<LatLng | null>(null)
  const [myPos, setMyPos] = useState<LatLng | null>(null)
  const [bbox, setBbox] = useState<Bbox | null>(null)

  const [stations, setStations] = useState<NearbyItem[]>([])
  const [brands, setBrands] = useState<Record<string, BrandRow>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  // 검색으로 찍은 장소(빨간 핀)
  const [selectedPlace, setSelectedPlace] = useState<{ name: string; lat: number; lng: number } | null>(null)
  const searchPinIcon = useMemo(() => makeSearchPinIcon(), [])

  const myDotIcon = useMemo(() => {
  const size = 26

  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:999px;
        background:rgba(45,95,210,0.15);
        display:grid;
        place-items:center;
        transform:translate(-50%,-50%);
      ">
        <div style="
          width:12px;
          height:12px;
          border-radius:999px;
          background:rgb(45,95,210);
          box-shadow:0 0 0 6px rgba(45,95,210,0.18);
        "></div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -12],
  })
}, [])

  const blueDotIcon = useMemo(() => makeDotIcon(7, 'rgb(45,95,210)'), [])
  const pin14 = useMemo(() => makePinIcon('sm'), [])

  // 1) 캐시/폴백 -> geolocation으로 덮어쓰기
  useEffect(() => {
    let cached: LatLng | null = null
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        if (typeof p?.lat === 'number' && typeof p?.lng === 'number') cached = { lat: p.lat, lng: p.lng }
      }
    } catch {}

    const first = cached ?? FALLBACK_CENTER
    setInitialView(first)
    if (cached) setMyPos(cached)

    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setMyPos({ lat, lng })
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ lat, lng }))
        } catch {}
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    )
  }, [])

  // 2) brands 로드(현재는 안 쓸 수도 있으니 유지)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('brands').select('brand_key,brand_name,logo_url')
      if (error) return
      if (cancelled) return
      const map: Record<string, BrandRow> = {}
      for (const r of (data ?? []) as any[]) map[r.brand_key] = r
      setBrands(map)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 3) bbox 변화 -> nearby 호출
  useEffect(() => {
    if (!bbox) return
    if (!isUsableBbox(bbox)) return

    const lat = (bbox.north + bbox.south) / 2
    const lng = (bbox.east + bbox.west) / 2
    const radius_km = Math.max(1, (Math.abs(bbox.north - bbox.south) * 111) / 2)

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius_km}&limit=50`)
        const data = await res.json()
        if (cancelled) return

        const items: NearbyItem[] = Array.isArray(data) ? data : (data.items ?? [])
        setStations(items)
      } catch (e: any) {
        if (cancelled) return
        setStations([])
        setError(e?.message ?? String(e))
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bbox])

  if (!initialView) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'ui-sans-serif' }}>
        Loading map...
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <MapContainer
        center={[myPos?.lat ?? initialView.lat, myPos?.lng ?? initialView.lng]}
        zoom={DEFAULT_ZOOM}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <BboxBinder onBbox={setBbox} />
        <LocateControl myPos={myPos} />
        <SearchControl onPickPlace={setSelectedPlace} />

        {/* 검색한 장소 표시(빨간 핀) */}
        {selectedPlace ? (
          <Marker position={[selectedPlace.lat, selectedPlace.lng]} icon={searchPinIcon}>
            <Popup>{selectedPlace.name}</Popup>
          </Marker>
        ) : null}

        {myPos ? (
          <Marker position={[myPos.lat, myPos.lng]} icon={myDotIcon}>
            <Popup>Mi ubicación</Popup>
          </Marker>
        ) : null}

        {bbox && isUsableBbox(bbox)
          ? stations.map((s) => {
              const z = bbox.zoom
              const logoUrl = s.brand_key ? brands[s.brand_key]?.logo_url : null

              let icon = blueDotIcon
              if (z <= 12) icon = blueDotIcon
              else if (z === 13 || z === 14) icon = pin14
              else if (z === 15) icon = makePricePinIcon({ logoUrl: null, price: s.magno_precio, size: 'sm', showLogo: false })
              else if (z === 16) icon = makePricePinIcon({ logoUrl: null, price: s.magno_precio, size: 'lg', showLogo: false })
              else if (z >= 17) icon = makePricePinIcon({ logoUrl, price: s.magno_precio, size: 'lg', showLogo: true })

              return (
                <Marker key={s.permiso} position={[s.lat, s.lng]} icon={icon}>
                  <Popup>
                    <StationPopup permiso={s.permiso} fallbackName={s.nombre ?? ''} fallbackAddress={s.direccion ?? ''} />
                  </Popup>
                </Marker>
              )
            })
          : null}
      </MapContainer>

      {/* 디버그 박스 */}
      <div
        style={{
          position: 'fixed',
          right: 12,
          top: 12,
          background: 'white',
          padding: '10px 12px',
          borderRadius: 12,
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
          fontSize: 12,
          minWidth: 240,
          zIndex: 9999,
        }}
      >
        <div>
          줌: <b>{bbox?.zoom ?? '-'}</b>
        </div>
        <div style={{ marginTop: 8 }}>
          표시(최대 50): <b>{stations.length}</b>
          {loading ? <span style={{ marginLeft: 8, opacity: 0.7 }}>cargando...</span> : null}
        </div>
        {error ? <div style={{ marginTop: 6, color: 'crimson' }}>{error}</div> : null}
      </div>
    </div>
  )
}