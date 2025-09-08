#!/usr/bin/env python3
"""
Piper TTS Service
Simple text-to-speech using Piper
"""

import base64
import logging
import os
import struct
from typing import Optional

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

try:
    from piper import PiperVoice
except ImportError:
    PiperVoice = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables for model
voice = None

def create_wav_file(audio_data, sample_rate=22050):
    """Create a proper WAV file with headers from audio data"""
    # Ensure audio_data is 16-bit integers
    if audio_data.dtype != np.int16:
        audio_data = (audio_data * 32767).astype(np.int16)
    
    # Convert to bytes
    audio_bytes = audio_data.tobytes()
    
    # WAV file header
    num_channels = 1  # Mono
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(audio_bytes)
    file_size = 36 + data_size
    
    # Create WAV header
    wav_header = struct.pack('<4sI4s4sIHHIIHH4sI',
        b'RIFF',                    # ChunkID
        file_size,                  # ChunkSize
        b'WAVE',                    # Format
        b'fmt ',                    # Subchunk1ID
        16,                         # Subchunk1Size (PCM)
        1,                          # AudioFormat (PCM)
        num_channels,               # NumChannels
        sample_rate,                # SampleRate
        byte_rate,                  # ByteRate
        block_align,                # BlockAlign
        bits_per_sample,            # BitsPerSample
        b'data',                    # Subchunk2ID
        data_size                   # Subchunk2Size
    )
    
    return wav_header + audio_bytes

def download_piper_model():
    """Download a small Piper TTS model if not present"""
    model_dir = "/app/models"
    model_name = "en_US-lessac-medium"
    model_url = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
    config_url = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
    
    model_path = os.path.join(model_dir, f"{model_name}.onnx")
    config_path = os.path.join(model_dir, f"{model_name}.onnx.json")
    
    # Download model if not exists
    if not os.path.exists(model_path):
        logger.info(f"Downloading Piper model: {model_name}")
        try:
            response = requests.get(model_url, stream=True)
            response.raise_for_status()
            with open(model_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            logger.info("Model downloaded successfully")
        except Exception as e:
            logger.error(f"Failed to download model: {e}")
            return None
    
    # Download config if not exists
    if not os.path.exists(config_path):
        logger.info(f"Downloading Piper config: {model_name}")
        try:
            response = requests.get(config_url, stream=True)
            response.raise_for_status()
            with open(config_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            logger.info("Config downloaded successfully")
        except Exception as e:
            logger.error(f"Failed to download config: {e}")
            return None
    
    return model_path

def load_piper_model():
    """Load Piper TTS model"""
    global voice

    try:
        if PiperVoice is None:
            logger.error("Piper TTS not available")
            return False

        logger.info("Loading Piper TTS model...")
        
        # Download model if needed
        model_path = download_piper_model()
        if model_path is None:
            logger.error("Failed to download Piper model")
            return False
        
        # Load the voice model
        voice = PiperVoice.load(model_path)
        logger.info("Piper TTS model loaded successfully")
        
        return True
    except Exception as e:
        logger.error(f"Failed to load Piper model: {e}")
        return False

# Initialize FastAPI app
app = FastAPI(
    title="Piper TTS Service", 
    version="1.0.0",
    description="Simple text-to-speech service using Piper"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for API
class ConvertRequest(BaseModel):
    text: str

class ConvertResponse(BaseModel):
    audio: str  # Base64 encoded audio data
    sample_rate: int
    duration: Optional[float] = None

@app.post("/tts/convert", response_model=ConvertResponse)
async def convert_text_to_speech(request: ConvertRequest):
    """
    Convert text to speech using Piper TTS.
    
    Args:
        request: Contains text to convert to speech
        
    Returns:
        ConvertResponse: Contains base64 encoded audio data
    """
    if voice is None:
        raise HTTPException(status_code=503, detail="Piper TTS model not loaded")
    
    try:
        # Use real Piper TTS to synthesize speech
        logger.info(f"Synthesizing text: '{request.text}'")
        
        # Synthesize audio using Piper
        audio_generator = voice.synthesize(request.text)
        
        # Convert generator to numpy array
        audio_chunks = list(audio_generator)
        logger.info(f"Got {len(audio_chunks)} audio chunks")
        
        # Debug: check what type of objects we have
        if audio_chunks:
            logger.info(f"First chunk type: {type(audio_chunks[0])}")
            logger.info(f"First chunk attributes: {dir(audio_chunks[0])}")
        
        # Try to extract audio data
        if audio_chunks:
            first_chunk = audio_chunks[0]
            if hasattr(first_chunk, 'audio_int16_bytes'):
                audio_bytes = b''.join(chunk.audio_int16_bytes for chunk in audio_chunks)
            elif hasattr(first_chunk, 'audio'):
                audio_bytes = b''.join(chunk.audio for chunk in audio_chunks)
            elif hasattr(first_chunk, 'data'):
                audio_bytes = b''.join(chunk.data for chunk in audio_chunks)
            else:
                # Assume chunks are already bytes or numpy arrays
                audio_bytes = b''.join(chunk for chunk in audio_chunks)
            
            audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
        else:
            raise Exception("No audio chunks generated")
        
        # Get sample rate from the audio chunk or voice model
        if audio_chunks:
            sample_rate = audio_chunks[0].sample_rate
        else:
            try:
                sample_rate = voice.config.audio.sample_rate
            except AttributeError:
                sample_rate = 22050  # Default sample rate
        
        # Calculate duration
        duration = len(audio_data) / sample_rate
        
        # Create proper WAV file with headers
        wav_data = create_wav_file(audio_data, sample_rate)
        
        # Encode to base64
        audio_base64 = base64.b64encode(wav_data).decode('utf-8')
        
        logger.info(f"Synthesis completed. Text length: {len(request.text)}, Duration: {duration:.2f}s")
        
        return ConvertResponse(
            audio=audio_base64,
            sample_rate=sample_rate,
            duration=duration
        )
        
    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_loaded": voice is not None,
        "service": "piper-tts"
    }

@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Piper TTS Service",
        "version": "1.0.0",
        "endpoints": {
            "convert": "/tts/convert",
            "health": "/health"
        }
    }

# Load model on startup
@app.on_event("startup")
async def startup_event():
    """Load Piper TTS model on startup"""
    logger.info("Starting TTS service...")
    if not load_piper_model():
        logger.error("Failed to load Piper TTS model. Service may not function properly.")
    logger.info("TTS service started successfully")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9002)