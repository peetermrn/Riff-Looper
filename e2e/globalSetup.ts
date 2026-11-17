import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Generate the test audio files with ffmpeg if they're missing. */
export default function globalSetup() {
  if (!existsSync('test-audio/click120.flac') || !existsSync('test-audio/tone440.wav')) {
    execSync('bash scripts/gen-test-audio.sh', { stdio: 'inherit' });
  }
}
