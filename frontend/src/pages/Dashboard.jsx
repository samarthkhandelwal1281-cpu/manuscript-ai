import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Upload,
    Database,
    Clock,
    CheckCircle,
    ChevronRight,
    FileText,
    RefreshCw,
} from 'lucide-react';

import manuscriptImg from '../assets/manuscript.jpeg';
import { getManuscripts } from '../api';

export default function Dashboard({ onAnalyze }) {
    const fileInputRef = useRef(null);
    const navigate = useNavigate();

    function openManuscript(manuscript) {
        if (!manuscript?.id) {
            return;
        }

        navigate(`/manuscript/${encodeURIComponent(manuscript.id)}`);
    }

    const [archives, setArchives] = useState([]);
    const [loadingArchives, setLoadingArchives] = useState(true);
    const [archiveError, setArchiveError] = useState('');

    useEffect(() => {
        loadArchives();
    }, []);

    async function loadArchives() {
        try {
            setLoadingArchives(true);
            setArchiveError('');

            const data = await getManuscripts();
            setArchives(Array.isArray(data) ? data : []);
        } catch (error) {
            setArchiveError(error.message);
        } finally {
            setLoadingArchives(false);
        }
    }

    function handleFileChange(event) {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        onAnalyze(file);
        event.target.value = '';
    }

    return (
        <div className="pt-32 px-8 max-w-7xl mx-auto pb-20">
            <div className="mb-10">
                <p className="text-gold text-xs uppercase tracking-[0.3em] font-bold mb-3">
                    Digital Heritage Archive
                </p>

                <h2 className="text-5xl font-serif text-white">
                    Manuscript Dashboard
                </h2>

                <p className="text-white/40 mt-3 max-w-2xl">
                    Upload a historical manuscript for AI-assisted
                    transcription, translation, rubrication detection,
                    and scholarly verification.
                </p>
            </div>

            {/* Upload */}
            <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/10 rounded-[2rem] p-16 bg-secondary/30 hover:bg-secondary/50 hover:border-gold/40 transition-all cursor-pointer text-center mb-16"
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                />

                <div className="w-20 h-20 bg-gold/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
                    <Upload
                        className="text-gold"
                        size={32}
                    />
                </div>

                <h3 className="text-2xl font-serif text-white mb-3">
                    Digitize New Manuscript
                </h3>

                <p className="text-white/35 text-sm mb-8">
                    Select a JPG, PNG, or WebP manuscript image
                    up to 20 MB.
                </p>

                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        fileInputRef.current?.click();
                    }}
                    className="px-10 py-4 bg-gold text-background font-black rounded-full text-xs uppercase tracking-widest hover:bg-goldLight"
                >
                    Choose Manuscript
                </button>
            </div>

            {/* Archive */}
            <div className="flex items-center justify-between mb-8">
                <h3 className="text-xs font-bold text-white/20 uppercase tracking-[0.4em]">
                    Recent Archives
                </h3>

                <button
                    onClick={loadArchives}
                    className="flex items-center gap-2 text-white/40 hover:text-gold text-xs"
                >
                    <RefreshCw size={14} />
                    Refresh
                </button>
            </div>

            {archiveError && (
                <div className="mb-6 p-4 rounded-xl border border-redInk/20 bg-redInk/5 text-redInk text-sm">
                    {archiveError}
                </div>
            )}

            {loadingArchives ? (
                <div className="text-white/30 text-sm py-10">
                    Loading archive...
                </div>
            ) : archives.length === 0 ? (
                <div className="bg-secondary border border-white/5 rounded-2xl p-10 text-center text-white/30">
                    <Database
                        size={30}
                        className="mx-auto mb-3 opacity-40"
                    />
                    <p>No verified manuscripts yet.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {archives.map((manuscript) => (
                        <div
                            key={manuscript.id}
                            onClick={() => openManuscript(manuscript)}
                            className="group bg-secondary p-5 rounded-2xl border border-white/5 flex gap-5 items-center hover:border-gold/30 transition-all cursor-pointer"
                        >
                            <div className="w-20 h-20 bg-white/5 rounded-xl overflow-hidden border border-white/5 shrink-0">
                                <img
                                    src={manuscriptImg}
                                    className="object-cover h-full w-full opacity-60 group-hover:opacity-100 transition-all"
                                    alt="Manuscript thumbnail"
                                />
                            </div>

                            <div className="min-w-0">
                                <p className="font-serif text-white truncate">
                                    {manuscript.title || 'Untitled Manuscript'}
                                </p>

                                <p className="text-[10px] text-green-400 uppercase font-bold tracking-wider mt-1">
                                    {manuscript.status || 'VERIFIED'}
                                </p>

                                <p className="text-[10px] text-white/30 mt-1 truncate">
                                    {manuscript.language || 'Unknown'} •{' '}
                                    {manuscript.script || 'Unknown'}
                                </p>

                                <button
                                    onClick={(event) => {
                                        // Keep the click from also firing the
                                        // card-level navigation twice.
                                        event.stopPropagation();
                                        openManuscript(manuscript);
                                    }}
                                    className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gold hover:text-goldLight transition-colors"
                                >
                                    View Details
                                    <ChevronRight size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-12">
                <Stat
                    icon={<Database size={18} />}
                    label="Archived"
                    value={archives.length}
                />

                <Stat
                    icon={<CheckCircle size={18} />}
                    label="Verified"
                    value={
                        archives.filter(
                            (item) => item.status === 'VERIFIED'
                        ).length
                    }
                />

                <Stat
                    icon={<FileText size={18} />}
                    label="AI Assisted"
                    value={archives.length}
                />

                <Stat
                    icon={<Clock size={18} />}
                    label="Processing"
                    value="Live"
                />
            </div>
        </div>
    );
}

function Stat({ icon, label, value }) {
    return (
        <div className="bg-secondary p-5 rounded-2xl border border-white/5">
            <div className="flex items-center gap-2 text-white/30 mb-2">
                {icon}
                <span className="text-[10px] uppercase tracking-widest font-bold">
          {label}
        </span>
            </div>

            <p className="text-2xl font-bold text-gold">
                {value}
            </p>
        </div>
    );
}