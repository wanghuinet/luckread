import React from 'react'
import '../(frontend)/styles.css'
import '../../styles/twitter-clone-globals.scss'

export default function TwitterCloneLayout(props: { children: React.ReactNode }) {
  return <html className="dark" lang="en"><body>{props.children}</body></html>
}
