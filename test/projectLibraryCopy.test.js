import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterProjectLibraryProjects,
  formatProjectLibraryText,
  formatProjectSummary,
  getProjectLibraryCopy,
  normalizeProjectLibraryLanguage,
} from '../src/projectLibraryCopy.js'

const projects = [
  {
    id: 'route-1',
    name: 'Morning Loop',
    archivedAt: null,
    summary: { pointCount: 3, distanceMeters: 4250 },
  },
  {
    id: 'route-2',
    name: 'Вечерний маршрут',
    archivedAt: '2026-07-14T12:00:00.000Z',
    summary: { pointCount: 21, distanceMeters: null },
  },
]

test('selects Russian copy explicitly and otherwise falls back to English', () => {
  assert.equal(normalizeProjectLibraryLanguage('ru'), 'ru')
  assert.equal(normalizeProjectLibraryLanguage('de'), 'en')
  assert.equal(getProjectLibraryCopy('ru').title, 'Библиотека маршрутов')
  assert.equal(getProjectLibraryCopy('unknown').title, 'Route project library')
})

test('formats named confirmation text without evaluating unknown placeholders', () => {
  assert.equal(
    formatProjectLibraryText('Archive “{name}” at {time}?', { name: 'Morning Loop' }),
    'Archive “Morning Loop” at {time}?',
  )
})

test('formats localized point counts and route distances', () => {
  assert.equal(formatProjectSummary(projects[0], 'en'), '3 points · 4.3 km')
  assert.equal(formatProjectSummary({ summary: { pointCount: 1, distanceMeters: 850 } }, 'en'), '1 point · 850 m')
  assert.equal(formatProjectSummary(projects[1], 'ru'), '21 точка · длина не рассчитана')
  assert.equal(formatProjectSummary({ summary: { pointCount: 4, distanceMeters: 1200 } }, 'ru'), '4 точки · 1,2 км')
  assert.equal(formatProjectSummary({ summary: { pointCount: 12, distanceMeters: 12000 } }, 'ru'), '12 точек · 12 км')
})

test('filters active and archived projects by localized case-insensitive name', () => {
  assert.deepEqual(
    filterProjectLibraryProjects(projects, { tab: 'active', query: 'MORNING', language: 'en' })
      .map(({ id }) => id),
    ['route-1'],
  )
  assert.deepEqual(
    filterProjectLibraryProjects(projects, { tab: 'archived', query: 'ВЕЧЕР', language: 'ru' })
      .map(({ id }) => id),
    ['route-2'],
  )
  assert.deepEqual(filterProjectLibraryProjects(null), [])
})
