import { memo } from 'react'

export type AppIconName =
  | 'file'
  | 'folder'
  | 'folderOpen'
  | 'files'
  | 'chapters'
  | 'characters'
  | 'plotlines'
  | 'risk'
  | 'git'
  | 'projectSwitch'
  | 'settings'
  | 'chat'
  | 'graph'
  | 'target'
  | 'refresh'
  | 'add'
  | 'save'
  | 'preview'

type AppIconProps = {
  name: AppIconName
  size?: number
  className?: string
  strokeWidth?: number
}

function IconPath({ name }: { name: AppIconName }) {
  switch (name) {
    case 'file':
      return (
        <>
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5" />
        </>
      )
    case 'folder':
      return <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    case 'folderOpen':
      return (
        <>
          <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V8z" />
          <path d="M3 11h18l-2 7a2 2 0 0 1-2 1H5a2 2 0 0 1-2-2v-6z" />
        </>
      )
    case 'files':
      return (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          <path d="M3 10h18" />
        </>
      )
    case 'chapters':
      return (
        <>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21V5.5z" />
          <path d="M8 7h7M8 11h7M8 15h5" />
        </>
      )
    case 'characters':
      return (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M3.5 18a4.5 4.5 0 0 1 9 0" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M14 18a3.8 3.8 0 0 1 6 0" />
        </>
      )
    case 'plotlines':
      return (
        <>
          <path d="M4 18V6" />
          <path d="M4 18h16" />
          <path d="M7 14l4-4 3 2 4-5" />
          <circle cx="7" cy="14" r="1" />
          <circle cx="11" cy="10" r="1" />
          <circle cx="14" cy="12" r="1" />
          <circle cx="18" cy="7" r="1" />
        </>
      )
    case 'risk':
      return (
        <>
          <path d="M12 2l8 3v6c0 5.2-3.3 9.3-8 11-4.7-1.7-8-5.8-8-11V5l8-3z" />
          <path d="M12 8v5" />
          <circle cx="12" cy="16.5" r="1" />
        </>
      )
    case 'git':
      return (
        <>
          <circle cx="7" cy="6" r="2" />
          <circle cx="17" cy="6" r="2" />
          <circle cx="17" cy="18" r="2" />
          <path d="M9 6h6M17 8v8M17 14h-4a3 3 0 0 1-3-3V8" />
        </>
      )
    case 'projectSwitch':
      return (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4" />
          <path d="M11 21l-3-3 3-3" />
          <path d="M8 18h8" />
        </>
      )
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.4 1.4a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0L4.3 17.8a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H3.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4L5.7 4a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.4 1.4a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6z" />
        </>
      )
    case 'chat':
      return (
        <>
          <path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          <path d="M8 10h8M8 13h5" />
        </>
      )
    case 'graph':
      return (
        <>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M8 6h8M7.3 7.5l3.4 8M16.7 7.5l-3.4 8" />
        </>
      )
    case 'target':
      return (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
        </>
      )
    case 'refresh':
      return (
        <>
          <path d="M20 11a8 8 0 1 0 2.2 5.6" />
          <path d="M22 4v6h-6" />
        </>
      )
    case 'add':
      return <path d="M12 5v14M5 12h14" />
    case 'save':
      return (
        <>
          <path d="M5 3h12l4 4v14H5z" />
          <path d="M8 3v6h8V3M8 17h8" />
        </>
      )
    case 'preview':
      return (
        <>
          <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )
    default:
      return null
  }
}

export const AppIcon = memo(function AppIcon({
  name,
  size = 18,
  className,
  strokeWidth = 1.8,
}: AppIconProps) {
  const classes = className ? `app-icon ${className}` : 'app-icon'
  return (
    <svg
      aria-hidden="true"
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <IconPath name={name} />
    </svg>
  )
})
