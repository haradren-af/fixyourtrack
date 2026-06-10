import { useEffect, useMemo, useRef, useState } from 'react'

const MINIMUM_WIDTH = 320
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

export default function TrackCharts({ onSelectionChange, samples, t }) {
  const [axis, setAxis] = useState('distance')
  const [selection, setSelection] = useState(null)
  const profile = useMemo(() => buildTrackProfile(samples), [samples])
  const hasTimeAxis = profile.some((point) => Number.isFinite(point.time))
  const activeAxis = axis === 'time' && hasTimeAxis ? 'time' : 'distance'
  const availableCharts = chartDefinitions.filter(({ key }) => (
    profile.some((point) => Number.isFinite(point[key]))
  ))

  useEffect(() => {
    onSelectionChange?.(getSelectedProfilePoints(profile, axis, selection))
  }, [axis, onSelectionChange, profile, selection])

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

function ProfileChart({ axis, definition, profile, selection, setSelection, t }) {
  const chartRef = useRef(null)
  const dragStartRef = useRef(null)
  const [measuredWidth, setMeasuredWidth] = useState(MINIMUM_WIDTH)
  const width = Math.max(MINIMUM_WIDTH, Math.round(measuredWidth))
  const points = profile.filter((point) => (
    Number.isFinite(point[axis]) && Number.isFinite(point[definition.key])
  ))
  const sampledPoints = downsample(points, Math.max(360, Math.round(width * 1.5)))

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
  const altitudeBackground = definition.key === 'speed'
    ? buildAltitudeBackground(profile, axis, xMin, xMax, width)
    : null
  const selectedRange = getSelectedRange(selection, xMin, xMax)
  const selectedPoints = selectedRange
    ? profile.filter((point) => (
      Number.isFinite(point[axis]) &&
      point[axis] >= selectedRange.start &&
      point[axis] <= selectedRange.end
    ))
    : profile
  const stats = buildChartStats(definition.key, selectedPoints, t)
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

  const firstValidTime = samples
    .map((sample) => parseTime(sample.time))
    .find(Number.isFinite)
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
  const points = downsample(
    profile.filter((point) => (
      Number.isFinite(point[axis]) &&
      point[axis] >= xMin &&
      point[axis] <= xMax &&
      Number.isFinite(point.altitude)
    )),
    Math.max(360, Math.round(width * 1.5)),
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

function getSelectedProfilePoints(profile, axis, selection) {
  if (!selection || !profile.length) {
    return []
  }

  const axisValues = profile.map((point) => point[axis])
  const validValues = axisValues.filter(Number.isFinite)
  if (!validValues.length) {
    return []
  }

  const range = getSelectedRange(selection, Math.min(...validValues), Math.max(...validValues))
  let startIndex = findClosestProfileIndex(profile, axis, range.start)
  let endIndex = findClosestProfileIndex(profile, axis, range.end)
  if (startIndex > endIndex) {
    [startIndex, endIndex] = [endIndex, startIndex]
  }

  return profile
    .slice(startIndex, endIndex + 1)
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .map(({ lat, lon }) => ({ lat, lon }))
}

function findClosestProfileIndex(profile, axis, target) {
  let closestIndex = 0
  let closestDistance = Number.POSITIVE_INFINITY

  profile.forEach((point, index) => {
    if (!Number.isFinite(point[axis])) {
      return
    }

    const distance = Math.abs(point[axis] - target)
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  })

  return closestIndex
}

function buildChartStats(key, points, t) {
  if (key === 'altitude') {
    const altitudes = points.map((point) => point.altitude).filter(Number.isFinite)
    let uphill = 0
    let downhill = 0
    for (let index = 1; index < points.length; index += 1) {
      const previousAltitude = points[index - 1].altitude
      const currentAltitude = points[index].altitude
      if (!Number.isFinite(previousAltitude) || !Number.isFinite(currentAltitude)) {
        continue
      }

      const difference = currentAltitude - previousAltitude
      if (difference > 0) {
        uphill += difference
      } else {
        downhill += Math.abs(difference)
      }
    }

    return [
      { label: t('chartUphill'), value: formatMeters(uphill) },
      { label: t('chartDownhill'), value: formatMeters(downhill) },
      { label: t('chartHighest'), value: formatMeters(Math.max(...altitudes)) },
      { label: t('chartLowest'), value: formatMeters(Math.min(...altitudes)) },
    ]
  }

  if (key === 'speed') {
    const speeds = points.map((point) => point.speed).filter(Number.isFinite)
    const elapsed = getElapsedTime(points)
    return [
      { label: t('chartAverageSpeed'), value: speeds.length ? `${formatYValue(average(speeds), key)} km/h` : '--' },
      { label: t('chartMovingTime'), value: formatDuration(getMovingTime(points)) },
      { label: t('chartElapsedTime'), value: formatDuration(elapsed) },
    ]
  }

  const heartRates = points.map((point) => point.heartRate).filter(Number.isFinite)
  return [
    { label: t('chartAverageHeartRate'), value: heartRates.length ? `${Math.round(average(heartRates))} bpm` : '--' },
    { label: t('chartMaximumHeartRate'), value: heartRates.length ? `${Math.round(Math.max(...heartRates))} bpm` : '--' },
    { label: t('chartMinimumHeartRate'), value: heartRates.length ? `${Math.round(Math.min(...heartRates))} bpm` : '--' },
  ]
}

function getElapsedTime(points) {
  const times = points.map((point) => point.time).filter(Number.isFinite)
  return times.length > 1 ? Math.max(...times) - Math.min(...times) : null
}

function getMovingTime(points) {
  let seconds = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const elapsed = current.time - previous.time
    if (Number.isFinite(elapsed) && elapsed > 0 && elapsed < 300 && current.speed > 1) {
      seconds += elapsed
    }
  }
  return seconds
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
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

function downsample(points, maxPoints) {
  if (points.length <= maxPoints) {
    return points
  }

  const step = (points.length - 1) / (maxPoints - 1)
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)])
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
