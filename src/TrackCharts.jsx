import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getSelectedProfilePoints } from './trackChartData'

const MINIMUM_WIDTH = 320
const MAXIMUM_RENDERED_PROFILE_POINTS = 5000
const HEIGHT = 160
const PADDING = {
  top: 30,
  right: 12,
  bottom: 24,
  left: 42,
}

const chartDefinitions = [
  {
    color: '#6da51d',
    fill: 'rgba(109, 165, 29, 0.18)',
    key: 'altitude',
    labelKey: 'chartAltitude',
    unit: 'm',
  },
  {
    color: '#d65b25',
    fill: 'rgba(214, 91, 37, 0.12)',
    key: 'speed',
    labelKey: 'chartSpeed',
    unit: 'km/h',
  },
  {
    color: '#c43c55',
    fill: 'rgba(196, 60, 85, 0.12)',
    key: 'heartRate',
    labelKey: 'chartHeartRate',
    unit: 'bpm',
  },
]

const altitudeDefinition = chartDefinitions.find(({ key }) => key === 'altitude')

function TrackCharts({ onSelectionChange, samples, t }) {
  const [axis, setAxis] = useState('distance')
  const [selection, setSelection] = useState(null)
  const profile = useMemo(() => buildTrackProfile(samples), [samples])
  const { availableCharts, hasTimeAxis } = useMemo(() => ({
    availableCharts: chartDefinitions.filter(({ key }) => (
      profile.some((point) => Number.isFinite(point[key]))
    )),
    hasTimeAxis: profile.some((point) => Number.isFinite(point.time)),
  }), [profile])
  const activeAxis = axis === 'time' && hasTimeAxis ? 'time' : 'distance'

  useEffect(() => {
    onSelectionChange?.(getSelectedProfilePoints(profile, activeAxis, selection))
  }, [activeAxis, onSelectionChange, profile, selection])

  useEffect(() => () => onSelectionChange?.([]), [onSelectionChange])

  if (!profile.length || !availableCharts.length) {
    return <p className="muted-text">{t('chartNoData')}</p>
  }

  return (
    <div className="track-charts">
      <div className="chart-axis-switch" role="group" aria-label={t('chartXAxis')}>
        <button
          type="button"
          className={activeAxis === 'distance' ? 'chart-axis-active' : ''}
          onClick={() => {
            setAxis('distance')
            setSelection(null)
          }}
        >
          {t('chartDistance')}
        </button>
        <button
          type="button"
          className={activeAxis === 'time' ? 'chart-axis-active' : ''}
          disabled={!hasTimeAxis}
          onClick={() => {
            setAxis('time')
            setSelection(null)
          }}
        >
          {t('chartTime')}
        </button>
      </div>

      {!hasTimeAxis ? <p className="chart-hint">{t('chartNoTime')}</p> : null}

      <div className="chart-stack">
        {availableCharts.map((definition) => (
          <ProfileChart
            key={definition.key}
            axis={activeAxis}
            definition={definition}
            profile={profile}
            selection={selection}
            setSelection={setSelection}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(TrackCharts)

function ProfileChart({ axis, definition, profile, selection, setSelection, t }) {
  const chartRef = useRef(null)
  const dragStartRef = useRef(null)
  const [measuredWidth, setMeasuredWidth] = useState(MINIMUM_WIDTH)
  const width = Math.max(MINIMUM_WIDTH, Math.round(measuredWidth))
  const sampledPoints = useMemo(() => downsampleMatching(
    profile,
    getChartSampleLimit(width),
    (point) => Number.isFinite(point[axis]) && Number.isFinite(point[definition.key]),
  ), [axis, definition.key, profile, width])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const updateWidth = () => setMeasuredWidth(chart.getBoundingClientRect().width)
    const observer = new ResizeObserver(updateWidth)
    observer.observe(chart)
    updateWidth()

    return () => observer.disconnect()
  }, [])

  const altitudeBackground = useMemo(() => {
    if (definition.key !== 'speed' || !sampledPoints.length) {
      return null
    }

    const sampledAxisValues = sampledPoints.map((point) => point[axis])
    return buildAltitudeBackground(
      profile,
      axis,
      Math.min(...sampledAxisValues),
      Math.max(...sampledAxisValues),
      width,
    )
  }, [axis, definition.key, profile, sampledPoints, width])

  if (!sampledPoints.length) {
    return null
  }

  const xValues = sampledPoints.map((point) => point[axis])
  const yValues = sampledPoints.map((point) => point[definition.key])
  const xMin = Math.min(...xValues)
  const xMax = Math.max(...xValues)
  const rawYMin = Math.min(...yValues)
  const rawYMax = Math.max(...yValues)
  const yPadding = Math.max((rawYMax - rawYMin) * 0.08, definition.key === 'heartRate' ? 2 : 1)
  const yMin = Math.max(0, rawYMin - yPadding)
  const yMax = rawYMax + yPadding
  const linePath = buildPath(sampledPoints, axis, definition.key, xMin, xMax, yMin, yMax, width)
  const chartBottom = HEIGHT - PADDING.bottom
  const areaPath = `${linePath} L ${width - PADDING.right} ${chartBottom} L ${PADDING.left} ${chartBottom} Z`
  const yTicks = [yMax, (yMax + yMin) / 2, yMin]
  const xTicks = buildTicks(xMin, xMax, width >= 700 ? 7 : width >= 480 ? 5 : 3)
  const selectedRange = getSelectedRange(selection, xMin, xMax)
  const stats = buildChartStats(definition.key, profile, t, axis, selectedRange)
  const selectionX = selectedRange
    ? scale(selectedRange.start, xMin, xMax, PADDING.left, width - PADDING.right)
    : null
  const selectionWidth = selectedRange
    ? scale(selectedRange.end, xMin, xMax, PADDING.left, width - PADDING.right) - selectionX
    : null

  function getAxisValue(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width
    const clampedX = Math.max(PADDING.left, Math.min(svgX, width - PADDING.right))
    return scale(clampedX, PADDING.left, width - PADDING.right, xMin, xMax)
  }

  function handlePointerDown(event) {
    const value = getAxisValue(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = value
    setSelection({ start: value, end: value })
  }

  function handlePointerMove(event) {
    if (dragStartRef.current === null) {
      return
    }
    setSelection({ start: dragStartRef.current, end: getAxisValue(event) })
  }

  function handlePointerEnd(event) {
    if (dragStartRef.current === null) {
      return
    }

    const end = getAxisValue(event)
    const start = dragStartRef.current
    dragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setSelection(Math.abs(end - start) < (xMax - xMin) * 0.005
      ? null
      : { start, end })
  }

  return (
    <section className="profile-chart" ref={chartRef}>
      <h3 className="profile-chart-heading">
        <span className="chart-swatch" style={{ background: definition.color }} />
        {t(definition.labelKey)}
      </h3>

      <div className="profile-chart-card">
        <p className="chart-selection-hint">
          {selectedRange
            ? t('chartSelectedRange', {
              from: formatAxisValue(selectedRange.start, axis),
              to: formatAxisValue(selectedRange.end, axis),
            })
            : t('chartSelectionHelp')}
        </p>

        <svg
          className="profile-chart-svg"
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`${t(definition.labelKey)}, ${t(axis === 'distance' ? 'chartByDistance' : 'chartByTime')}`}
        >
          {altitudeBackground ? (
            <g className="chart-altitude-background" aria-hidden="true">
              <path d={altitudeBackground.areaPath} fill={altitudeDefinition.fill} />
              <path
                className="chart-line"
                d={altitudeBackground.linePath}
                stroke={altitudeDefinition.color}
              />
            </g>
          ) : null}

          {yTicks.map((tick, index) => {
            const y = scale(tick, yMin, yMax, chartBottom, PADDING.top)
            return (
              <g key={`y-${index}`}>
                <line className="chart-grid-line" x1={PADDING.left} x2={width - PADDING.right} y1={y} y2={y} />
                <text className="chart-axis-label chart-axis-label-y" x={PADDING.left - 6} y={y + 3}>
                  {formatYValue(tick, definition.key)}
                </text>
              </g>
            )
          })}

          <path d={areaPath} fill={definition.fill} />
          <path className="chart-line" d={linePath} stroke={definition.color} />

          <g className="chart-endpoint-marker chart-endpoint-start" aria-hidden="true">
            <circle cx={PADDING.left} cy={16} r={10} />
            <text x={PADDING.left} y={19}>A</text>
          </g>
          <g className="chart-endpoint-marker chart-endpoint-end" aria-hidden="true">
            <circle cx={width - PADDING.right} cy={16} r={10} />
            <text x={width - PADDING.right} y={19}>B</text>
          </g>

          {selectedRange ? (
            <g className="chart-selection" aria-hidden="true">
              <rect
                height={chartBottom - PADDING.top}
                width={selectionWidth}
                x={selectionX}
                y={PADDING.top}
              />
              <line x1={selectionX} x2={selectionX} y1={PADDING.top} y2={chartBottom} />
              <line x1={selectionX + selectionWidth} x2={selectionX + selectionWidth} y1={PADDING.top} y2={chartBottom} />
            </g>
          ) : null}

          {xTicks.map((tick, index) => {
            const x = scale(tick, xMin, xMax, PADDING.left, width - PADDING.right)
            return (
              <text
                className="chart-axis-label chart-axis-label-x"
                key={`x-${index}`}
                textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
                x={x}
                y={HEIGHT - 6}
              >
                {formatAxisValue(tick, axis)}
              </text>
            )
          })}

          <text className="chart-unit-label" x={PADDING.left + 16} y={19}>{definition.unit}</text>
        </svg>

        <div className="chart-stat-grid">
          {stats.map((stat) => (
            <div className="chart-stat" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function buildTrackProfile(samples) {
  if (!samples?.length) {
    return []
  }

  let firstValidTime = null
  for (const sample of samples) {
    const timestamp = parseTime(sample.time)
    if (Number.isFinite(timestamp)) {
      firstValidTime = timestamp
      break
    }
  }
  let cumulativeDistance = 0

  return samples.map((sample, index) => {
    const previous = samples[index - 1]
    if (previous && hasCoordinates(previous) && hasCoordinates(sample)) {
      cumulativeDistance += haversineDistance(previous, sample)
    }

    const timestamp = parseTime(sample.time)
    const speed = Number.isFinite(sample.speed)
      ? sample.speed * 3.6
      : deriveSpeed(previous, sample)

    return {
      altitude: Number.isFinite(sample.ele) ? sample.ele : null,
      distance: cumulativeDistance,
      heartRate: Number.isFinite(sample.heartRate) ? sample.heartRate : null,
      lat: Number.isFinite(sample.lat) ? sample.lat : null,
      lon: Number.isFinite(sample.lon) ? sample.lon : null,
      speed,
      time: Number.isFinite(timestamp) && Number.isFinite(firstValidTime)
        ? Math.max(0, (timestamp - firstValidTime) / 1000)
        : null,
    }
  })
}

function deriveSpeed(previous, current) {
  if (!previous || !hasCoordinates(previous) || !hasCoordinates(current)) {
    return null
  }

  const previousTime = parseTime(previous.time)
  const currentTime = parseTime(current.time)
  const seconds = (currentTime - previousTime) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return (haversineDistance(previous, current) / seconds) * 3.6
}

function buildPath(points, axis, valueKey, xMin, xMax, yMin, yMax, width) {
  return points.map((point, index) => {
    const x = scale(point[axis], xMin, xMax, PADDING.left, width - PADDING.right)
    const y = scale(point[valueKey], yMin, yMax, HEIGHT - PADDING.bottom, PADDING.top)
    return `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

function buildAltitudeBackground(profile, axis, xMin, xMax, width) {
  const points = downsampleMatching(
    profile,
    getChartSampleLimit(width),
    (point) => (
      Number.isFinite(point[axis]) &&
      point[axis] >= xMin &&
      point[axis] <= xMax &&
      Number.isFinite(point.altitude)
    ),
  )
  if (!points.length) {
    return null
  }

  const altitudeValues = points.map((point) => point.altitude)
  const rawMinimum = Math.min(...altitudeValues)
  const rawMaximum = Math.max(...altitudeValues)
  const padding = Math.max((rawMaximum - rawMinimum) * 0.08, 1)
  const minimum = rawMinimum - padding
  const maximum = rawMaximum + padding
  const linePath = buildPath(points, axis, 'altitude', xMin, xMax, minimum, maximum, width)
  const chartBottom = HEIGHT - PADDING.bottom

  return {
    areaPath: `${linePath} L ${width - PADDING.right} ${chartBottom} L ${PADDING.left} ${chartBottom} Z`,
    linePath,
  }
}

function buildTicks(minimum, maximum, count) {
  return Array.from({ length: count }, (_, index) => (
    minimum + ((maximum - minimum) * index) / (count - 1)
  ))
}

function getSelectedRange(selection, minimum, maximum) {
  if (!selection) {
    return null
  }

  return {
    start: Math.max(minimum, Math.min(selection.start, selection.end)),
    end: Math.min(maximum, Math.max(selection.start, selection.end)),
  }
}

function buildChartStats(key, profile, t, axis, selectedRange) {
  if (key === 'altitude') {
    let uphill = 0
    let downhill = 0
    let highest = Number.NEGATIVE_INFINITY
    let lowest = Number.POSITIVE_INFINITY
    let previousAltitude = null
    let hasPreviousPoint = false

    for (const point of profile) {
      if (!isPointInRange(point, axis, selectedRange)) {
        continue
      }

      const currentAltitude = point.altitude
      if (Number.isFinite(currentAltitude)) {
        highest = Math.max(highest, currentAltitude)
        lowest = Math.min(lowest, currentAltitude)
        if (hasPreviousPoint && Number.isFinite(previousAltitude)) {
          const difference = currentAltitude - previousAltitude
          if (difference > 0) {
            uphill += difference
          } else {
            downhill += Math.abs(difference)
          }
        }
      }
      previousAltitude = currentAltitude
      hasPreviousPoint = true
    }

    return [
      { label: t('chartUphill'), value: formatMeters(uphill) },
      { label: t('chartDownhill'), value: formatMeters(downhill) },
      { label: t('chartHighest'), value: formatMeters(highest) },
      { label: t('chartLowest'), value: formatMeters(lowest) },
    ]
  }

  if (key === 'speed') {
    let earliestTime = Number.POSITIVE_INFINITY
    let latestTime = Number.NEGATIVE_INFINITY
    let movingTime = 0
    let previousPoint = null
    let speedCount = 0
    let speedTotal = 0
    let timeCount = 0

    for (const point of profile) {
      if (!isPointInRange(point, axis, selectedRange)) {
        continue
      }

      if (Number.isFinite(point.speed)) {
        speedTotal += point.speed
        speedCount += 1
      }
      if (Number.isFinite(point.time)) {
        earliestTime = Math.min(earliestTime, point.time)
        latestTime = Math.max(latestTime, point.time)
        timeCount += 1
      }
      if (previousPoint) {
        const elapsed = point.time - previousPoint.time
        if (Number.isFinite(elapsed) && elapsed > 0 && elapsed < 300 && point.speed > 1) {
          movingTime += elapsed
        }
      }
      previousPoint = point
    }

    const elapsed = timeCount > 1 ? latestTime - earliestTime : null
    return [
      { label: t('chartAverageSpeed'), value: speedCount ? `${formatYValue(speedTotal / speedCount, key)} km/h` : '--' },
      { label: t('chartMovingTime'), value: formatDuration(movingTime) },
      { label: t('chartElapsedTime'), value: formatDuration(elapsed) },
    ]
  }

  let heartRateCount = 0
  let heartRateTotal = 0
  let maximumHeartRate = Number.NEGATIVE_INFINITY
  let minimumHeartRate = Number.POSITIVE_INFINITY
  for (const point of profile) {
    if (!isPointInRange(point, axis, selectedRange) || !Number.isFinite(point.heartRate)) {
      continue
    }

    heartRateCount += 1
    heartRateTotal += point.heartRate
    maximumHeartRate = Math.max(maximumHeartRate, point.heartRate)
    minimumHeartRate = Math.min(minimumHeartRate, point.heartRate)
  }

  return [
    { label: t('chartAverageHeartRate'), value: heartRateCount ? `${Math.round(heartRateTotal / heartRateCount)} bpm` : '--' },
    { label: t('chartMaximumHeartRate'), value: heartRateCount ? `${Math.round(maximumHeartRate)} bpm` : '--' },
    { label: t('chartMinimumHeartRate'), value: heartRateCount ? `${Math.round(minimumHeartRate)} bpm` : '--' },
  ]
}

function isPointInRange(point, axis, selectedRange) {
  return !selectedRange || (
    Number.isFinite(point[axis]) &&
    point[axis] >= selectedRange.start &&
    point[axis] <= selectedRange.end
  )
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${Math.round(value)} m` : '--'
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return '--'
  }

  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainingSeconds = rounded % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function downsampleMatching(points, maxPoints, matches) {
  let matchCount = 0
  for (const point of points) {
    if (matches(point)) {
      matchCount += 1
    }
  }

  if (!matchCount) {
    return []
  }

  const outputCount = Math.min(matchCount, maxPoints)
  const step = outputCount > 1 ? (matchCount - 1) / (outputCount - 1) : 0
  const sampled = []
  let matchIndex = 0
  let outputIndex = 0
  let targetIndex = 0

  for (const point of points) {
    if (!matches(point)) {
      continue
    }
    if (matchIndex === targetIndex) {
      sampled.push(point)
      outputIndex += 1
      targetIndex = Math.round(outputIndex * step)
    }
    matchIndex += 1
    if (outputIndex >= outputCount) {
      break
    }
  }

  return sampled
}

function getChartSampleLimit(width) {
  return Math.min(MAXIMUM_RENDERED_PROFILE_POINTS, Math.max(360, Math.round(width * 1.5)))
}

function scale(value, sourceMin, sourceMax, targetMin, targetMax) {
  if (sourceMax === sourceMin) {
    return (targetMin + targetMax) / 2
  }

  return targetMin + ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin)
}

function formatYValue(value, key) {
  if (key === 'heartRate' || Math.abs(value) >= 100) {
    return Math.round(value)
  }

  return value.toFixed(1)
}

function formatChartDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatChartTime(seconds) {
  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainingSeconds = rounded % 60

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function formatAxisValue(value, axis) {
  return axis === 'distance' ? formatChartDistance(value) : formatChartTime(value)
}

function parseTime(value) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

function hasCoordinates(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
}

function haversineDistance(first, second) {
  const earthRadius = 6371000
  const lat1 = toRadians(first.lat)
  const lat2 = toRadians(second.lat)
  const deltaLat = toRadians(second.lat - first.lat)
  const deltaLon = toRadians(second.lon - first.lon)
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRadians(value) {
  return value * (Math.PI / 180)
}
