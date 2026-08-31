import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react'

export function Icon({ name }: { name: 'home' | 'scan' | 'echo' | 'backpack' | 'weapon' | 'build' | 'team' | 'optimize' | 'download' | 'upload' | 'lock' | 'unlock' | 'discard' | 'trash' | 'edit' | 'plus' | 'info' | 'settings' | 'more' | 'discord' | 'chevron' }) {
  const paths: Record<typeof name, ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/></>,
    scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M7 12h10M12 7v10"/></>,
    echo: <>
      <g transform="translate(-1.2 -1.2) scale(1.1)">
        <path fill="currentColor" stroke="none" fillRule="evenodd" d="m12 9.2-6.4 4.9L12 21l6.4-6.9L12 9.2Zm0 3.2 2.5 1.8-2.5 3-2.5-3 2.5-1.8Z"/>
        <path fill="currentColor" stroke="none" d="m11.2 8.1-4-2.8L9.4 2l3.3 2.3-1.5 3.8Zm2.1.5 1.4-4.1L17.6 2l1.3 2.7-3.5 4.1-2.1-.2Z"/>
      </g>
    </>,
    backpack: <><path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M5 8h14l1 13H4L5 8Z"/><path d="M8 13h8v5H8z"/><path d="M4.5 12H3v6h1M19.5 12H21v6h-1"/></>,
    weapon: <>
      <g fill="currentColor" stroke="none" transform="rotate(-45 12 12)">
        <path d="m12 1.2 2.4 1.7-1.5 9.2h-1.8L9.6 2.9 12 1.2Z"/>
        <path d="M7.8 11.2h8.4v2.5H7.8zM10.8 13.2h2.4v6.5h-2.4zM9.7 19.2h4.6v2.5H9.7z"/>
      </g>
      <g fill="currentColor" stroke="none" transform="rotate(45 12 12)">
        <path d="m12 1.2 2.4 1.7-1.5 9.2h-1.8L9.6 2.9 12 1.2Z"/>
        <path d="M7.8 11.2h8.4v2.5H7.8zM10.8 13.2h2.4v6.5h-2.4zM9.7 19.2h4.6v2.5H9.7z"/>
      </g>
    </>,
    build: <><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></>,
    team: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 20c.5-5 2.5-7 5.5-7s5 2 5.5 7M14 15c3.5 0 5.5 1.5 6 5"/></>,
    optimize: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    unlock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M16 10V7a4 4 0 0 0-7.7-1.5"/></>,
    discard: <><circle cx="12" cy="12" r="8"/><path d="m6.4 17.6 11.2-11.2"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z"/><path d="m13.5 7 3.5 3.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></>,
    discord: <path fill="currentColor" stroke="none" d="M19.3 5.4A16 16 0 0 0 15.4 4l-.5 1.1a14.7 14.7 0 0 0-5.8 0L8.6 4a16 16 0 0 0-3.9 1.4C2.2 9.1 1.5 12.7 1.8 16.2a16 16 0 0 0 4.8 2.4l1.2-1.7-1.8-.8.4-.3c3.5 1.6 7.7 1.6 11.2 0l.4.3-1.8.8 1.2 1.7a16 16 0 0 0 4.8-2.4c.4-4.1-.7-7.7-2.9-10.8ZM8.7 14.2c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Zm6.6 0c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2Z"/>,
    chevron: <path d="m7 9 5 5 5-5"/>
  }
  return <svg className={`icon${name === 'plus' ? ' icon-plus' : ''}`} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export function Panel({ children, className = '', ...props }: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return <section className={`panel ${className}`} {...props}>{children}</section>
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>
}
