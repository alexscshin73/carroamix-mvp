'use client'

import dynamic from 'next/dynamic'

const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'ui-sans-serif' }}>
      Loading map...
    </div>
  ),
})

export default function MapPageClient() {
  return <MapClient />
}