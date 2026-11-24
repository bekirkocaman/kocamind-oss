// Dört noktalı KocaMind işareti (Android KmMark). Düşünürken döner ve nefes alır, azaltılmış harekette durağandır.
export function LogoMark({ size = 24, state = 'idle', label }) {
  return (
    <svg
      className={`km-mark km-mark-${state}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <g className="km-mark-dots">
        <circle className="km-mark-accent" cx="12" cy="5" r="3" />
        <circle cx="19" cy="12" r="3" />
        <circle cx="12" cy="19" r="3" />
        <circle cx="5" cy="12" r="3" />
      </g>
    </svg>
  )
}
