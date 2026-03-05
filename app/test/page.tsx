'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src,
  iconUrl: markerIcon.src,
  shadowUrl: markerShadow.src,
})

export default function TestPage() {
  const [rows, setRows] = useState<any[]>([])
  const [error, setError] = useState<string>('')

  useEffect(() => {
    async function run() {
      const { data, error } = await supabase
        .from('v_station_latest_prices')
        .select('*')
        .limit(5)

      if (error) setError(error.message)
      else setRows(data ?? [])
    }
    run()
  }, [])

  return (
    <div style={{ padding: 16, fontFamily: 'ui-sans-serif' }}>
      <h1>Supabase test</h1>

      {error ? (
        <pre style={{ whiteSpace: 'pre-wrap', color: 'crimson' }}>{error}</pre>
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </div>
  )
}