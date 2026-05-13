import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error("Visualizer render failure", error);
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-rose-500/40 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/40">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-rose-300">
            Visualizer Error
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white">
            The dashboard hit a runtime error instead of rendering.
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            This usually means the frontend received unexpected session data or an older API
            payload shape. Restart the API bridge and refresh the page.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-sm leading-6 text-rose-200">
            {this.state.error.message}
          </pre>
        </div>
      </div>
    );
  }
}
