import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './i18n';
import './ErrorBoundary.css';

/**
 * Last line of defence: a render error shows what broke instead of a blank
 * page. The board autosaves, so reloading loses at most the last second.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  override state = { error: null as Error | null, stack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ stack: `${error.stack ?? error.message}\n\nComponent stack:${info.componentStack ?? ''}` });
  }

  override render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n\n${stack}`;
    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <h1>{t('crash.title')}</h1>
          <p>{t('crash.body')}</p>
          <pre className="crash-message">{`${error.name}: ${error.message}`}</pre>
          <div className="crash-actions">
            <button type="button" className="crash-primary" onClick={() => location.reload()}>
              {t('crash.reload')}
            </button>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(details)}>
              {t('crash.copy')}
            </button>
          </div>
          <details>
            <summary>{t('crash.details')}</summary>
            <pre className="crash-stack">{stack}</pre>
          </details>
        </div>
      </div>
    );
  }
}
