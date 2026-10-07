"""One isolated inference; the API stays available and can terminate a stalled model."""
import sys
import audio_service

if __name__ == '__main__':
    audio_service.analyze_queued(sys.argv[1])
