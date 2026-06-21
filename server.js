const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // optional

// Ensure temp directory
const tmpDir = path.join(os.tmpdir(), 'glassdl');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ─── Helper: run yt-dlp ──────────────────────────────────────
function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        exec(`yt-dlp ${args}`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(stderr || error.message);
            else resolve(stdout);
        });
    });
}

// ─── API: Get video info ──────────────────────────────────────
app.get('/info', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    try {
        const stdout = await runYtDlp(`-j "${url}"`);
        const info = JSON.parse(stdout);
        // Extract formats
        const formats = (info.formats || []).map(f => ({
            format_id: f.format_id,
            resolution: f.height ? `${f.height}p` : 'audio',
            filesize: f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + ' MB' : '—',
            ext: f.ext,
            acodec: f.acodec,
            vcodec: f.vcodec,
        }));
        // Sort by height descending
        formats.sort((a, b) => {
            const ah = parseInt(a.resolution) || 0;
            const bh = parseInt(b.resolution) || 0;
            return bh - ah;
        });
        res.json({
            title: info.title,
            source: info.extractor_key || 'Unknown',
            thumbnail: info.thumbnail,
            duration: info.duration,
            formats: formats,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch video info' });
    }
});

// ─── API: Download video ──────────────────────────────────────
app.post('/download', async (req, res) => {
    const { url, formatId } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    try {
        // Use yt-dlp to get a direct download URL (or download file)
        // We'll return a downloadable link via temporary file
        const filename = `video_${Date.now()}.mp4`;
        const filepath = path.join(tmpDir, filename);
        await runYtDlp(`-f ${formatId} -o "${filepath}" "${url}"`);
        // Serve the file
        res.json({
            downloadUrl: `/downloads/${filename}`,
            filename: filename,
            filesize: fs.statSync(filepath).size
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Download failed' });
    }
});

// ─── Serve downloaded files ──────────────────────────────────
app.get('/downloads/:filename', (req, res) => {
    const filepath = path.join(tmpDir, req.params.filename);
    if (fs.existsSync(filepath)) {
        res.download(filepath);
        // Optional: delete after download
        setTimeout(() => fs.unlinkSync(filepath), 60 * 1000);
    } else {
        res.status(404).send('File not found');
    }
});

// ─── Ping ──────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, () => console.log(`🚀 GlassDL backend running on port ${PORT}`));
