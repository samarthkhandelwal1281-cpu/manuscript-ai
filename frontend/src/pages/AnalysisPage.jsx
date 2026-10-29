import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle,
    FileText,
    ShieldCheck,
    Type,
    Save,
} from 'lucide-react';

import { verifyManuscript } from '../api';

export default function AnalysisPage({
                                         analysis,
                                         imageUrl,
                                         onVerified,
                                     }) {
    const [form, setForm] = useState({
        title: analysis?.title || '',
        author: analysis?.author || '',
        language: analysis?.language || '',
        script: analysis?.script || '',
        confidence: analysis?.confidence ?? 0,
        extractedText: analysis?.extractedText || '',
        redInk: analysis?.redInk || '',
        translation: analysis?.translation || '',
        flaggedWords: analysis?.flaggedWords || [],
    });

    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(false);
    const [error, setError] = useState('');

    const flaggedCount = useMemo(
        () => form.flaggedWords?.length || 0,
        [form.flaggedWords]
    );

    function updateField(field, value) {
        setForm((current) => ({
            ...current,
            [field]: value,
        }));
    }

    async function handleVerify() {
        if (!analysis?.id) {
            setError('Missing manuscript ID.');
            return;
        }

        if (!form.extractedText.trim()) {
            setError('The extracted manuscript text cannot be empty.');
            return;
        }

        setVerifying(true);
        setError('');

        try {
            const saved = await verifyManuscript(
                analysis.id,
                form
            );

            setVerified(true);
            onVerified?.(saved);
        } catch (err) {
            setError(err.message);
        } finally {
            setVerifying(false);
        }
    }

    return (
        <div className="pt-28 px-8 max-w-[1600px] mx-auto pb-20">
            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between gap-6 mb-8">
                <div>
                    <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-[10px] bg-gold/10 text-gold px-2 py-1 rounded font-bold uppercase tracking-wider border border-gold/20">
              AI Extraction Complete
            </span>

                        {form.redInk?.trim() && (
                            <span className="text-[10px] bg-redInk/10 text-redInk px-2 py-1 rounded font-bold uppercase tracking-wider border border-redInk/20">
                Red Ink Detected
              </span>
                        )}

                        <span className="text-[10px] bg-white/5 text-white/50 px-2 py-1 rounded font-bold uppercase tracking-wider border border-white/10">
              {form.language || 'Unknown'}
            </span>
                    </div>

                    <h1 className="text-4xl font-serif text-white">
                        {form.title || 'Untitled Manuscript'}
                    </h1>

                    <p className="text-white/40 italic">
                        {form.author || 'Author unknown'}
                    </p>

                    <p className="text-[10px] text-white/20 mt-2 font-mono">
                        ID: {analysis.id}
                    </p>
                </div>

                <button
                    onClick={handleVerify}
                    disabled={verifying || verified}
                    className={`px-8 py-3 rounded-lg font-bold transition-all flex items-center gap-2 justify-center ${
                        verified
                            ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                            : 'bg-gold text-background hover:bg-goldLight shadow-lg shadow-gold/20'
                    } disabled:opacity-60`}
                >
                    {verified ? (
                        <>
                            <CheckCircle size={18} />
                            Digitally Archived
                        </>
                    ) : verifying ? (
                        <>
                            <Save
                                size={18}
                                className="animate-pulse"
                            />
                            Verifying...
                        </>
                    ) : (
                        <>
                            <ShieldCheck size={18} />
                            Verify & Save Results
                        </>
                    )}
                </button>
            </div>

            {error && (
                <div className="mb-6 bg-redInk/10 border border-redInk/20 rounded-xl p-4 text-sm text-redInk">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

                {/* ORIGINAL IMAGE */}
                <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-secondary shadow-2xl aspect-[3/4]">
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt="Uploaded manuscript"
                            className="w-full h-full object-contain p-6"
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center text-white/20">
                            No manuscript preview available
                        </div>
                    )}

                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className="w-full h-[3px] bg-gold/60 shadow-[0_0_20px_rgba(215,168,75,0.8)] animate-scan top-0" />
                    </div>
                </div>

                {/* RESULTS */}
                <div className="space-y-6 overflow-y-auto max-h-[1000px] pr-4 custom-scrollbar">

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4">
                        <InfoCard
                            label="AI Confidence"
                            value={`${form.confidence}%`}
                            gold
                        />

                        <InfoCard
                            label="Language"
                            value={form.language || 'Unknown'}
                        />

                        <InfoCard
                            label="Script"
                            value={form.script || 'Unknown'}
                        />
                    </div>

                    {/* Metadata editing */}
                    <div className="bg-secondary border border-white/10 rounded-2xl p-6">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-gold mb-4">
                            Manuscript Metadata
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="Title"
                                value={form.title}
                                onChange={(value) =>
                                    updateField('title', value)
                                }
                            />

                            <Input
                                label="Author"
                                value={form.author}
                                onChange={(value) =>
                                    updateField('author', value)
                                }
                            />

                            <Input
                                label="Language"
                                value={form.language}
                                onChange={(value) =>
                                    updateField('language', value)
                                }
                            />

                            <Input
                                label="Script"
                                value={form.script}
                                onChange={(value) =>
                                    updateField('script', value)
                                }
                            />
                        </div>
                    </div>

                    {/* Red ink */}
                    <div className="bg-redInk/5 border border-redInk/20 rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-3">
                            <FileText
                                size={16}
                                className="text-redInk"
                            />
                            <h3 className="text-redInk text-[10px] font-black uppercase tracking-widest">
                                Extracted Red Ink
                            </h3>
                        </div>

                        <textarea
                            value={form.redInk}
                            onChange={(event) =>
                                updateField(
                                    'redInk',
                                    event.target.value
                                )
                            }
                            className="w-full min-h-[100px] bg-transparent border border-redInk/10 rounded-xl p-4 font-serif text-xl leading-relaxed text-redInk focus:outline-none focus:border-redInk/40 resize-none"
                        />
                    </div>

                    {/* Main text */}
                    <div className="bg-secondary border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
                        <div className="flex bg-white/5 border-b border-white/10 px-8 py-4 items-center justify-between">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-gold flex items-center gap-2">
                                <Type size={14} />
                                Main Manuscript Text
                            </h3>

                            <span className="text-[10px] text-white/30 uppercase">
                AI-assisted • editable
              </span>
                        </div>

                        <div className="p-8">
              <textarea
                  value={form.extractedText}
                  onChange={(event) =>
                      updateField(
                          'extractedText',
                          event.target.value
                      )
                  }
                  className="w-full min-h-[600px] bg-transparent border border-white/5 rounded-2xl p-8 font-serif text-xl leading-[1.7] text-parchment/90 focus:outline-none focus:border-gold/30 transition-all resize-y"
              />
                        </div>
                    </div>

                    {/* Translation */}
                    <div className="bg-secondary border border-white/10 rounded-2xl p-6">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-gold mb-4">
                            English Translation
                        </h3>

                        <textarea
                            value={form.translation}
                            onChange={(event) =>
                                updateField(
                                    'translation',
                                    event.target.value
                                )
                            }
                            className="w-full min-h-[220px] bg-transparent border border-white/5 rounded-xl p-5 font-serif text-lg leading-relaxed text-white/80 focus:outline-none focus:border-gold/30 resize-y"
                        />
                    </div>

                    {/* Flags */}
                    <div className="bg-amber-500/5 p-6 rounded-2xl border border-amber-500/20">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                                <AlertTriangle size={20} />
                            </div>

                            <div className="min-w-0">
                                <p className="text-sm font-bold text-amber-500">
                                    Human Verification Required
                                </p>

                                <p className="text-xs text-white/40 leading-relaxed mt-1">
                                    Gemini flagged {flaggedCount} reading
                                    {flaggedCount === 1 ? '' : 's'} for review.
                                    Correct these before archival.
                                </p>

                                {flaggedCount > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-4">
                                        {form.flaggedWords.map(
                                            (word, index) => (
                                                <span
                                                    key={`${word}-${index}`}
                                                    className="text-xs px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400"
                                                >
                          {word}
                        </span>
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {verified && (
                        <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-6">
                            <div className="flex items-center gap-3 text-green-400">
                                <CheckCircle size={20} />
                                <div>
                                    <p className="font-bold">
                                        Manuscript archived successfully
                                    </p>
                                    <p className="text-xs text-white/40 mt-1">
                                        The AI result and human-reviewed version are
                                        preserved separately in the backend.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function InfoCard({ label, value, gold = false }) {
    return (
        <div className="bg-secondary p-4 rounded-2xl border border-white/5">
            <p className="text-[10px] text-white/30 uppercase mb-1 font-bold">
                {label}
            </p>
            <p
                className={`text-lg font-bold ${
                    gold ? 'text-gold' : 'text-white'
                }`}
            >
                {value}
            </p>
        </div>
    );
}

function Input({ label, value, onChange }) {
    return (
        <label className="block">
      <span className="block text-[10px] text-white/30 uppercase font-bold tracking-widest mb-2">
        {label}
      </span>

            <input
                value={value}
                onChange={(event) =>
                    onChange(event.target.value)
                }
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-gold/40"
            />
        </label>
    );
}