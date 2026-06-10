import { Component } from 'react'
import packageMetadata from '../package.json'
import { createSafeErrorReport } from './errorReport'

export default class ErrorBoundary extends Component {
  state = {
    report: null,
  }

  static getDerivedStateFromError(error) {
    return {
      report: createSafeErrorReport(error, packageMetadata.version),
    }
  }

  downloadReport = () => {
    const blob = new Blob([JSON.stringify(this.state.report, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `fixyourtrack-diagnostic-${this.state.report.occurredAt.replaceAll(':', '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  render() {
    if (!this.state.report) {
      return this.props.children
    }

    const isRussian = window.localStorage.getItem('fixyourtrack-language') !== 'en'
    return (
      <main className="crash-page">
        <section className="crash-panel">
          <p className="eyebrow">FixYourTrack</p>
          <h1>{isRussian ? 'Приложение остановилось из-за ошибки.' : 'The application stopped because of an error.'}</h1>
          <p>
            {isRussian
              ? 'Ваш трек не отправлялся. Можно перезагрузить приложение или скачать безопасный диагностический файл.'
              : 'Your track was not transmitted. Reload the application or download a privacy-safe diagnostic file.'}
          </p>
          <p className="crash-code">
            {isRussian ? 'Категория' : 'Category'}: {this.state.report.category}
          </p>
          <div className="crash-actions">
            <button type="button" onClick={() => window.location.reload()}>
              {isRussian ? 'Перезагрузить' : 'Reload'}
            </button>
            <button type="button" onClick={this.downloadReport}>
              {isRussian ? 'Скачать диагностику' : 'Download diagnostic'}
            </button>
          </div>
        </section>
      </main>
    )
  }
}
