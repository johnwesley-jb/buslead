import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { FileAudio, Pause, Play, RefreshCw, RotateCcw, RotateCw, VolumeX } from 'lucide-react'
import type { Call } from '@/lib/types'
import { clock, fmt } from '@/lib/dates'
import { cn } from '@/lib/format'
import { useRefreshRecording } from '@/hooks/queries'
import { recordingUrl } from '@/api'
import { Waveform } from './Waveform'
import { Button, EmptyState } from './ui'

const SPEEDS = [1, 1.5, 2]

/**
 * Recording player + synced transcript.
 *
 * With the real API, an <audio> element streams `/api/calls/:id/recording` (authorized by the session cookie).
 * In the preview (simulated data) there is no file, so a clock advances through the call instead; seeking and
 * transcript sync behave the same way.
 */
export function CallPlayback({ call, showLeadLink }: { call: Call; showLeadLink?: boolean }) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const refresh = useRefreshRecording()
  const src = recordingUrl(call.id)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioError, setAudioError] = useState(false)
  const duration = call.durationSeconds
  const available = call.recordingStatus === 'available'

  // Reset when switching calls.
  useEffect(() => {
    setTime(0)
    setPlaying(false)
    setAudioError(false)
  }, [call.id])

  useEffect(() => {
    if (!playing || src) return
    const tick = setInterval(() => {
      setTime((t) => {
        const next = t + 0.1 * speed
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
    }, 100)
    return () => clearInterval(tick)
  }, [playing, speed, duration, src])

  // Real audio: the element is the source of truth for position and play state.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !src) return
    const onTime = () => setTime(a.currentTime)
    const onEnd = () => setPlaying(false)
    const onErr = () => {
      setPlaying(false)
      setAudioError(true)
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', onEnd)
    a.addEventListener('error', onErr)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnd)
      a.removeEventListener('error', onErr)
    }
  }, [src, available, call.id])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const seek = useCallback(
    (t: number) => {
      const v = Math.max(0, Math.min(duration, t))
      if (audioRef.current && src) audioRef.current.currentTime = v
      setTime(v)
    },
    [duration, src],
  )

  const togglePlay = () => {
    const a = audioRef.current
    if (a && src) {
      if (a.paused) {
        if (time >= duration) a.currentTime = 0
        a.play().then(() => setPlaying(true)).catch(() => setAudioError(true))
      } else {
        a.pause()
        setPlaying(false)
      }
      return
    }
    if (time >= duration) setTime(0)
    setPlaying((p) => !p)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-canvas p-4">
        {available ? (
          <>
            <div className="relative h-16">
              <Waveform seed={call.id} count={72} progress={duration ? time / duration : 0} className="h-full" />
              <input
                type="range"
                min={0}
                max={duration}
                step={0.5}
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Seek recording"
                aria-valuetext={`${clock(time)} of ${clock(duration)}`}
                className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink/60 peer-focus-visible:w-0.5 peer-focus-visible:bg-teal" style={{ left: `${duration ? (time / duration) * 100 : 0}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="num flex items-baseline gap-1.5 text-sm text-ink-2" aria-live="off">
                <span className="font-semibold text-ink">{clock(time)}</span>
                <span>/ {clock(duration)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => seek(time - 10)} aria-label="Back 10 seconds">
                  <RotateCcw className="size-4" aria-hidden />
                </Button>
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause' : 'Play'}
                  className="press grid size-11 place-items-center rounded-full bg-teal text-white hover:bg-teal-deep"
                >
                  {playing ? <Pause className="size-4" aria-hidden /> : <Play className="ml-0.5 size-4" aria-hidden />}
                </button>
                <Button size="sm" variant="ghost" onClick={() => seek(time + 10)} aria-label="Forward 10 seconds">
                  <RotateCw className="size-4" aria-hidden />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label={`Playback speed ${speed}x. Change speed`} className="num w-12">
                  {speed}x
                </Button>
              </div>
            </div>
            {src && <audio ref={audioRef} src={src} preload="metadata" className="hidden" />}
            {audioError ? (
              <p role="alert" className="mt-3 text-xs text-coral">The recording could not be played. It may have expired. Use “Check again” or try later.</p>
            ) : !src ? (
              <p className="mt-3 text-xs text-mute">Preview playback. No audio file is attached to demo calls.</p>
            ) : null}
          </>
        ) : call.recordingStatus === 'processing' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-brass-soft text-brass">
                <FileAudio className="size-5" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium">Recording is still processing</p>
                <p className="text-xs text-mute">Recordings usually appear a few minutes after a call ends.</p>
              </div>
            </div>
            <Button onClick={() => refresh.mutate(call.id)} loading={refresh.isPending}>
              <RefreshCw className="size-4" aria-hidden /> Check again
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-2">
            <div className="grid size-10 place-items-center rounded-full bg-slate-soft text-mute">
              <VolumeX className="size-5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium">No recording for this call</p>
              <p className="text-xs text-mute">Recording may be switched off for this number, or Vapi did not return a file. The transcript is below when available.</p>
            </div>
          </div>
        )}
      </div>

      <Transcript call={call} time={available ? time : -1} playing={playing} onSeek={available ? seek : undefined} showLeadLink={showLeadLink} />
    </div>
  )
}

function Transcript({ call, time, playing, onSeek, showLeadLink }: { call: Call; time: number; playing: boolean; onSeek?: (t: number) => void; showLeadLink?: boolean }) {
  const segs = call.transcript
  const activeRef = useRef<HTMLLIElement>(null)
  const listRef = useRef<HTMLOListElement>(null)

  let active = -1
  if (segs && time >= 0) segs.forEach((s, i) => (s.startSec <= time ? (active = i) : null))

  useEffect(() => {
    if (!playing || !activeRef.current || !listRef.current) return
    const list = listRef.current
    const el = activeRef.current
    const top = el.offsetTop - list.offsetTop
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTo({ top: top - 24, behavior: 'smooth' })
  }, [active, playing])

  if (call.processingStatus === 'failed') {
    return <EmptyState title="Transcript could not be processed">Processing failed for this call. The lead was saved, and processing will retry automatically.</EmptyState>
  }
  if (!segs) {
    return <EmptyState title="Transcript is on its way">The call was received {fmt.dateTime(call.startedAt)}. The transcript appears here when Vapi finishes processing it.</EmptyState>
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-base">Transcript</h3>
        {call.callerDisconnected && <span className="text-xs text-brass">Caller hung up before choosing a time</span>}
      </div>
      <ol ref={listRef} className="scrollbar-thin max-h-[26rem] space-y-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-2" aria-label="Call transcript">
        {segs.map((s, i) => {
          const isActive = i === active
          return (
            <li key={i} ref={isActive ? activeRef : undefined}>
              <button
                type="button"
                onClick={() => onSeek?.(s.startSec)}
                disabled={!onSeek}
                className={cn('grid w-full grid-cols-[3rem_1fr] gap-3 rounded-md px-2.5 py-2 text-left transition-colors', isActive ? 'bg-teal-soft' : onSeek ? 'hover:bg-sunken' : '', !onSeek && 'cursor-default')}
              >
                <span className="num pt-0.5 text-xs text-mute">{clock(s.startSec)}</span>
                <span>
                  <span className={cn('block text-xs font-semibold', s.speaker === 'assistant' ? 'text-teal-deep' : 'text-brass')}>{s.speaker === 'assistant' ? 'Receptionist' : 'Caller'}</span>
                  <span className="block text-sm leading-relaxed text-ink">{s.text}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {showLeadLink && (
        <p className="mt-2 text-xs text-mute">
          Linked lead: <Link to={`/leads/${call.leadId}`} className="font-medium text-teal-deep underline underline-offset-2">open lead</Link>
        </p>
      )}
    </div>
  )
}
