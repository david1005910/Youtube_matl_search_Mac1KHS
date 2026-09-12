#!/usr/bin/env python3
"""
Local Stable Diffusion Server for Mac Apple Silicon (MPS) & CUDA/CPU
Provides lightweight REST API for local text-to-image generation.
"""

import os
import sys
import io
import json
import base64
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

PORT = int(os.environ.get("LOCAL_SD_PORT", 7865))
DEFAULT_MODEL = os.environ.get("LOCAL_SD_MODEL", "stabilityai/sd-turbo")

pipeline = None
pipe_lock = threading.Lock()
current_device = "cpu"
current_model_name = DEFAULT_MODEL
is_loading = False
load_error = None

def get_device_and_dtype():
    import torch
    if torch.backends.mps.is_available():
        return "mps", torch.float16
    elif torch.cuda.is_available():
        return "cuda", torch.float16
    return "cpu", torch.float32

def load_pipeline(model_id=DEFAULT_MODEL):
    global pipeline, current_device, current_model_name, is_loading, load_error
    import torch
    from diffusers import AutoPipelineForText2Image, DiffusionPipeline

    with pipe_lock:
        if pipeline is not None and current_model_name == model_id:
            return pipeline
        
        is_loading = True
        load_error = None
        device, dtype = get_device_and_dtype()
        current_device = device
        print(f"🚀 Loading Local Stable Diffusion model '{model_id}' on {device.upper()} ({dtype})...")
        
        try:
            pipe = AutoPipelineForText2Image.from_pretrained(
                model_id,
                torch_dtype=dtype,
                variant="fp16" if dtype == torch.float16 else None,
            )
            pipe.to(device)
            if device == "mps":
                # Enable memory efficient attention or optimizations if available
                pipe.enable_attention_slicing()
            pipeline = pipe
            current_model_name = model_id
            print(f"✅ Local SD model '{model_id}' successfully loaded and ready on {device.upper()}!")
            return pipeline
        except Exception as e:
            print(f"❌ Failed to load model '{model_id}': {e}")
            load_error = str(e)
            raise e
        finally:
            is_loading = False

def generate_image(prompt, negative_prompt="", width=512, height=512, steps=None, guidance_scale=None, seed=None):
    import torch
    pipe = load_pipeline(current_model_name)
    device, _ = get_device_and_dtype()

    generator = None
    if seed is not None and seed >= 0:
        generator = torch.Generator(device=device).manual_seed(seed)

    # Defaults for turbo vs standard models
    is_turbo = "turbo" in current_model_name.lower()
    num_steps = steps if steps is not None else (4 if is_turbo else 25)
    guidance = guidance_scale if guidance_scale is not None else (0.0 if is_turbo else 7.5)

    with pipe_lock:
        with torch.inference_mode():
            extra_kwargs = {}
            if negative_prompt and not is_turbo:
                extra_kwargs["negative_prompt"] = negative_prompt

            result = pipe(
                prompt=prompt,
                width=width,
                height=height,
                num_inference_steps=num_steps,
                guidance_scale=guidance,
                generator=generator,
                **extra_kwargs
            )
            image = result.images[0]
            
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
            return b64_str

class SDHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Concise logging
        print(f"[{self.log_date_time_string()}] {self.command} {self.path} - {args[0]}")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"status": "ok"})

    def do_GET(self):
        if self.path in ["/health", "/api/status", "/"]:
            self._send_json(200, {
                "status": "ready" if pipeline is not None else ("loading" if is_loading else "idle"),
                "device": current_device,
                "model": current_model_name,
                "loaded": pipeline is not None,
                "loading": is_loading,
                "error": load_error
            })
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            data = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception as e:
            self._send_json(400, {"error": f"Invalid JSON: {e}"})
            return

        if self.path in ["/api/generate", "/api/proxy/local-sd"]:
            prompt = data.get("prompt", "").strip()
            if not prompt:
                self._send_json(400, {"error": "prompt is required"})
                return

            negative_prompt = data.get("negative_prompt", "")
            width = int(data.get("width", 512))
            height = int(data.get("height", 512))
            steps = data.get("steps")
            guidance_scale = data.get("guidance_scale")
            seed = data.get("seed")

            # Support aspect_ratio if passed
            aspect_ratio = data.get("aspect_ratio", "")
            if aspect_ratio == "16:9":
                width, height = 768, 432
            elif aspect_ratio == "9:16":
                width, height = 432, 768
            elif aspect_ratio == "1:1":
                width, height = 512, 512

            # Ensure dimensions are multiples of 8
            width = (width // 8) * 8
            height = (height // 8) * 8

            t0 = time.time()
            try:
                b64_img = generate_image(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    steps=int(steps) if steps else None,
                    guidance_scale=float(guidance_scale) if guidance_scale is not None else None,
                    seed=int(seed) if seed is not None else None
                )
                elapsed = time.time() - t0
                print(f"✨ Image generated in {elapsed:.2f}s (size: {width}x{height})")
                self._send_json(200, {
                    "image": b64_img,
                    "mimeType": "image/png",
                    "elapsed": round(elapsed, 2),
                    "device": current_device,
                    "model": current_model_name
                })
            except Exception as e:
                self._send_json(500, {"error": f"Generation failed: {e}"})

        # Automatic1111 / WebUI compatibility endpoint
        elif self.path == "/sdapi/v1/txt2img":
            prompt = data.get("prompt", "").strip()
            negative_prompt = data.get("negative_prompt", "")
            width = int(data.get("width", 512))
            height = int(data.get("height", 512))
            steps = int(data.get("steps", 4))
            cfg_scale = float(data.get("cfg_scale", 0.0))
            seed = data.get("seed", -1)

            try:
                b64_img = generate_image(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    steps=steps,
                    guidance_scale=cfg_scale,
                    seed=seed
                )
                self._send_json(200, {
                    "images": [b64_img],
                    "parameters": data,
                    "info": json.dumps({"prompt": prompt, "model": current_model_name})
                })
            except Exception as e:
                self._send_json(500, {"error": str(e)})

        elif self.path == "/api/load-model":
            model_id = data.get("model", DEFAULT_MODEL)
            try:
                load_pipeline(model_id)
                self._send_json(200, {"status": "loaded", "model": current_model_name, "device": current_device})
            except Exception as e:
                self._send_json(500, {"error": str(e)})

        else:
            self._send_json(404, {"error": "Unknown endpoint"})

def start_server(port=PORT):
    server = HTTPServer(("127.0.0.1", port), SDHandler)
    print(f"🌟 Local Stable Diffusion Server running on http://127.0.0.1:{port}")
    print(f"   Model: {DEFAULT_MODEL} | Device: Auto-detect (MPS on Mac)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Local SD Server.")
        server.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    start_server(port)
