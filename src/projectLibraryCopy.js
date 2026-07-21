const copy = Object.freeze({
  en: Object.freeze({
    eyebrow: 'FixYourTrack',
    title: 'Route project library',
    intro: 'Projects stay on this device only; no cloud account or sync is used. Open a saved route or archive it without deleting it.',
    close: 'Close route project library',
    newProject: 'New route',
    activeTab: 'Active',
    archivedTab: 'Archived',
    activeTabLabel: 'Active route projects, {count}',
    archivedTabLabel: 'Archived route projects, {count}',
    searchActive: 'Search active routes',
    searchArchived: 'Search archived routes',
    searchPlaceholder: 'Search by project name',
    loading: 'Loading route projects…',
    working: 'Updating project…',
    current: 'Open now',
    readOnly: 'Read-only',
    unsupported: 'Created by a newer app version',
    corrupt: 'Needs recovery',
    actionsFor: 'Actions for {name}',
    open: 'Open',
    openNamed: 'Open {name}',
    rename: 'Rename',
    renameNamed: 'Rename {name}',
    duplicate: 'Duplicate',
    duplicateNamed: 'Duplicate {name}',
    archive: 'Archive',
    archiveNamed: 'Archive {name}',
    restore: 'Restore',
    restoreNamed: 'Restore {name}',
    delete: 'Delete',
    deleteNamed: 'Delete {name}',
    renameField: 'New name for {name}',
    saveName: 'Save name',
    cancel: 'Cancel',
    confirmArchiveTitle: 'Archive “{name}”?',
    confirmArchiveBody: 'You can restore this route later from the Archived tab.',
    confirmArchive: 'Archive route',
    confirmDeleteTitle: 'Permanently delete “{name}”?',
    confirmDeleteBody: 'This removes the saved project from this device and cannot be undone.',
    confirmDelete: 'Delete permanently',
    emptyActive: 'No active route projects yet.',
    emptyArchived: 'No archived route projects.',
    noSearchResults: 'No projects match “{query}”.',
    resultCount: '{count} projects shown',
    resultCountOne: '1 project shown',
    pointOne: '1 point',
    pointMany: '{count} points',
    distanceUnavailable: 'distance not calculated',
    actionFailed: 'The project action could not be completed. Try again.',
  }),
  ru: Object.freeze({
    eyebrow: 'FixYourTrack',
    title: 'Библиотека маршрутов',
    intro: 'Проекты хранятся только на этом устройстве, без облачной учётной записи и синхронизации. Откройте маршрут или перенесите его в архив без удаления.',
    close: 'Закрыть библиотеку маршрутов',
    newProject: 'Новый маршрут',
    activeTab: 'Активные',
    archivedTab: 'Архив',
    activeTabLabel: 'Активные проекты маршрутов: {count}',
    archivedTabLabel: 'Архивные проекты маршрутов: {count}',
    searchActive: 'Поиск активных маршрутов',
    searchArchived: 'Поиск архивных маршрутов',
    searchPlaceholder: 'Поиск по названию проекта',
    loading: 'Загрузка проектов маршрутов…',
    working: 'Обновление проекта…',
    current: 'Сейчас открыт',
    readOnly: 'Только чтение',
    unsupported: 'Создано в более новой версии приложения',
    corrupt: 'Требуется восстановление',
    actionsFor: 'Действия с проектом {name}',
    open: 'Открыть',
    openNamed: 'Открыть {name}',
    rename: 'Переименовать',
    renameNamed: 'Переименовать {name}',
    duplicate: 'Создать копию',
    duplicateNamed: 'Создать копию проекта {name}',
    archive: 'В архив',
    archiveNamed: 'Переместить {name} в архив',
    restore: 'Восстановить',
    restoreNamed: 'Восстановить {name}',
    delete: 'Удалить',
    deleteNamed: 'Удалить {name}',
    renameField: 'Новое название для {name}',
    saveName: 'Сохранить название',
    cancel: 'Отмена',
    confirmArchiveTitle: 'Переместить «{name}» в архив?',
    confirmArchiveBody: 'Маршрут можно будет восстановить на вкладке «Архив».',
    confirmArchive: 'Переместить в архив',
    confirmDeleteTitle: 'Удалить «{name}» навсегда?',
    confirmDeleteBody: 'Сохранённый проект будет удалён с этого устройства без возможности восстановления.',
    confirmDelete: 'Удалить навсегда',
    emptyActive: 'Активных проектов маршрутов пока нет.',
    emptyArchived: 'В архиве нет проектов маршрутов.',
    noSearchResults: 'Нет проектов по запросу «{query}».',
    resultCount: 'Показано проектов: {count}',
    resultCountOne: 'Показан 1 проект',
    pointOne: '1 точка',
    pointFew: '{count} точки',
    pointMany: '{count} точек',
    distanceUnavailable: 'длина не рассчитана',
    actionFailed: 'Не удалось выполнить действие с проектом. Попробуйте ещё раз.',
  }),
})

export function normalizeProjectLibraryLanguage(language) {
  return language === 'ru' ? 'ru' : 'en'
}

export function getProjectLibraryCopy(language) {
  return copy[normalizeProjectLibraryLanguage(language)]
}

export function formatProjectLibraryText(template, values = {}) {
  if (typeof template !== 'string') {
    return ''
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ))
}

export function formatProjectSummary(project, language = 'en') {
  const normalizedLanguage = normalizeProjectLibraryLanguage(language)
  const translations = getProjectLibraryCopy(normalizedLanguage)
  const pointCount = Number.isSafeInteger(project?.summary?.pointCount) && project.summary.pointCount >= 0
    ? project.summary.pointCount
    : 0
  const distanceMeters = Number.isFinite(project?.summary?.distanceMeters) && project.summary.distanceMeters >= 0
    ? project.summary.distanceMeters
    : null

  const pointText = formatPointCount(pointCount, normalizedLanguage, translations)
  const distanceText = distanceMeters === null
    ? translations.distanceUnavailable
    : formatDistance(distanceMeters, normalizedLanguage)
  return `${pointText} · ${distanceText}`
}

export function filterProjectLibraryProjects(projects, { tab = 'active', query = '', language = 'en' } = {}) {
  if (!Array.isArray(projects)) {
    return []
  }
  const normalizedLanguage = normalizeProjectLibraryLanguage(language)
  const normalizedQuery = normalizeSearchText(query, normalizedLanguage)
  const archived = tab === 'archived'

  return projects.filter((project) => {
    if (!project || typeof project !== 'object' || typeof project.id !== 'string') {
      return false
    }
    if ((project.archivedAt !== null && project.archivedAt !== undefined) !== archived) {
      return false
    }
    if (!normalizedQuery) {
      return true
    }
    return normalizeSearchText(project.name, normalizedLanguage).includes(normalizedQuery)
  })
}

function formatPointCount(count, language, translations) {
  if (language === 'en') {
    return count === 1
      ? translations.pointOne
      : formatProjectLibraryText(translations.pointMany, { count })
  }

  const pluralCategory = new Intl.PluralRules('ru').select(count)
  if (pluralCategory === 'one') {
    return count === 1
      ? translations.pointOne
      : formatProjectLibraryText('{count} точка', { count })
  }
  if (pluralCategory === 'few') {
    return formatProjectLibraryText(translations.pointFew, { count })
  }
  return formatProjectLibraryText(translations.pointMany, { count })
}

function formatDistance(distanceMeters, language) {
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  if (distanceMeters < 1000) {
    const meters = Math.round(distanceMeters)
    return language === 'ru'
      ? `${new Intl.NumberFormat(locale).format(meters)} м`
      : `${new Intl.NumberFormat(locale).format(meters)} m`
  }

  const kilometers = distanceMeters / 1000
  const maximumFractionDigits = kilometers < 10 ? 1 : 0
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(kilometers)
  return language === 'ru' ? `${formatted} км` : `${formatted} km`
}

function normalizeSearchText(value, language) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase(language) : ''
}
