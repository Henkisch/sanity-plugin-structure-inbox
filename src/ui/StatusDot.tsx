import {keyframes, styled} from 'styled-components'

/**
 * Deliberately fixed accents rather than theme tones: this is a small,
 * decorative status signal, not content that needs to read correctly
 * against an arbitrary tone background the way a `Card`'s own palette does.
 */
const ACCENT_COLORS = {
  attention: '#f5a623',
  clear: '#2fb344',
} as const

const ping = keyframes`
  75%, 100% {
    transform: scale(2.5);
    opacity: 0;
  }
`

const Ring = styled.span<{$color: string}>`
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background-color: ${(props) => props.$color};
  animation: ${ping} 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;

  /* Purely decorative and looping — under reduced motion it conveys nothing
     a static dot doesn't already say, so it is removed rather than slowed. */
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    display: none;
  }
`

const Core = styled.span<{$color: string}>`
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  background-color: ${(props) => props.$color};
`

const Root = styled.span`
  position: relative;
  display: inline-flex;
  width: 8px;
  height: 8px;
  flex: none;
`

interface StatusDotProps {
  /**
   * Amber for "something needs a look", green for "all clear". A pulsing
   * green dot would read as urgent, which contradicts what an all-clear
   * state is telling the editor — so `pulsing` defaults to whether there is
   * anything to pulse about.
   *
   * @defaultValue tone === 'attention'
   */
  tone?: 'attention' | 'clear'
  pulsing?: boolean
}

/**
 * A small status dot for the pane heading — pulsing amber when something is
 * waiting, calm green when it isn't. The "there's a live thing here" signal
 * a nav item's own icon can't carry once it's set once at
 * structure-definition time.
 */
export function StatusDot(props: StatusDotProps) {
  const {tone = 'attention', pulsing = tone === 'attention'} = props
  const color = ACCENT_COLORS[tone]

  return (
    <Root aria-hidden="true">
      {pulsing && <Ring $color={color} />}
      <Core $color={color} />
    </Root>
  )
}
