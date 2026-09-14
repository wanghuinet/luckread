import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Luckread self-media platform.',
  title: 'Luckread',
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><main>{props.children}</main></body>
    </html>
  )
}
