import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import AnalysisPage from './pages/AnalysisPage';
import ManuscriptDetailPage from './pages/ManuscriptDetailPage';
import AboutPage from './pages/AboutPage';
import NotFoundPage from './pages/NotFoundPage';
import ProcessingOverlay from './components/ProcessingOverlay';

import { analyzeManuscript } from './api';

export default function App() {
  const navigate = useNavigate();

  const [analysis, setAnalysis] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);

  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(
      'Enhancing Image'
  );
  const [error, setError] = useState('');

  // The analysis request currently allowed to update the UI.
  const activeRequestRef = useRef(null);

  async function handleStartAnalysis(file) {
    if (!file) {
      return;
    }

    // A new upload supersedes any request still in flight.
    activeRequestRef.current?.abort();

    const controller = new AbortController();
    activeRequestRef.current = controller;

    setImageUrl(URL.createObjectURL(file));
    setAnalysis(null);
    setError('');
    setCurrentStep('Enhancing Image');
    setLoading(true);

    try {
      const result = await analyzeManuscript(
          file,
          (event) => {
            if (
                event.type === 'progress' &&
                activeRequestRef.current === controller
            ) {
              setCurrentStep(event.step);
            }
          },
          controller.signal
      );

      // Ignore results from a cancelled or superseded request.
      if (activeRequestRef.current !== controller) {
        return;
      }

      activeRequestRef.current = null;
      setAnalysis(result);
      setLoading(false);
      navigate('/analysis');
    } catch (err) {
      // Cancellation is intentional and must not surface as an error.
      if (
          controller.signal.aborted ||
          activeRequestRef.current !== controller
      ) {
        return;
      }

      activeRequestRef.current = null;

      // Keep the overlay open so the error panel is visible;
      // its Close button dismisses it.
      setError(err.message || 'Manuscript analysis failed.');
    }
  }

  function handleCancelProcessing() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setLoading(false);
    setError('');
  }

  function handleVerified(savedManuscript) {
    setAnalysis((current) => ({
      ...current,
      ...savedManuscript,
      status: savedManuscript.status,
    }));
  }

  // Abort any in-flight analysis when the app unmounts.
  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
    };
  }, []);

  // Revoke the preview URL once it is replaced, cleared, or App unmounts.
  useEffect(() => {
    if (!imageUrl) {
      return;
    }

    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  return (
      <div className="min-h-screen bg-background font-sans text-textMain selection:bg-gold selection:text-background">
        <Navbar />

        {loading && (
            <ProcessingOverlay
                currentStep={currentStep}
                error={error}
                onCancel={handleCancelProcessing}
            />
        )}

        {!loading && (
            <Routes>
              <Route
                  path="/"
                  element={
                    <LandingPage
                        onStart={() => navigate('/dashboard')}
                    />
                  }
              />

              <Route
                  path="/dashboard"
                  element={
                    <Dashboard
                        onAnalyze={handleStartAnalysis}
                    />
                  }
              />

              <Route
                  path="/manuscript/:id"
                  element={<ManuscriptDetailPage />}
              />

              <Route
                  path="/analysis"
                  element={
                    analysis ? (
                        <AnalysisPage
                            analysis={analysis}
                            imageUrl={imageUrl}
                            onVerified={handleVerified}
                        />
                    ) : (
                        <Navigate to="/dashboard" replace />
                    )
                  }
              />

              <Route
                  path="/about"
                  element={<AboutPage />}
              />

              <Route
                  path="*"
                  element={<NotFoundPage />}
              />
            </Routes>
        )}
      </div>
  );
}
