import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import subprocess
import threading
import serial
import serial.tools.list_ports
import os
import sys

# Configuración de Rutas
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ARDUINO_CLI = os.path.join(BASE_DIR, "..", "Emulador", "arduino-cli.exe")
SKETCH_PATH = os.path.join(BASE_DIR, "Esp32.ino")

class VitalSyncFlasherApp:
    def __init__(self, root):
        self.root = root
        self.root.title("VitalSync AI - Herramienta de Flasheo y Monitor ESP32")
        self.root.geometry("640x520")
        self.root.minsize(550, 450)
        self.root.configure(bg="#0f172a")

        self.serial_conn = None
        self.is_monitoring = False

        self.setup_ui()
        self.refresh_ports()

    def setup_ui(self):
        # Header
        header_frame = tk.Frame(self.root, bg="#1e293b", pady=12)
        header_frame.pack(fill="x")

        title = tk.Label(header_frame, text="⚡ VitalSync AI - Control de Hardware ESP32", 
                         font=("Segoe UI", 13, "bold"), fg="#38bdf8", bg="#1e293b")
        title.pack()
        subtitle = tk.Label(header_frame, text="Grabación Directa sin Bloqueos | Monitor Serial Integrado", 
                            font=("Segoe UI", 9), fg="#94a3b8", bg="#1e293b")
        subtitle.pack()

        # Control Bar
        ctrl_frame = tk.Frame(self.root, bg="#0f172a", padx=15, pady=10)
        ctrl_frame.pack(fill="x")

        tk.Label(ctrl_frame, text="Puerto COM:", font=("Segoe UI", 10, "bold"), fg="#e2e8f0", bg="#0f172a").pack(side="left", padx=5)
        
        self.port_combo = ttk.Combobox(ctrl_frame, width=16, state="readonly")
        self.port_combo.pack(side="left", padx=5)

        btn_refresh = tk.Button(ctrl_frame, text="🔄", command=self.refresh_ports, 
                                bg="#334155", fg="white", font=("Segoe UI", 9, "bold"), relief="flat", padx=6)
        btn_refresh.pack(side="left", padx=3)

        btn_unlock = tk.Button(ctrl_frame, text="🔓 Liberar Puerto", command=self.unlock_port,
                               bg="#dc2626", fg="white", font=("Segoe UI", 9, "bold"), relief="flat", padx=8)
        btn_unlock.pack(side="right", padx=5)

        # Action Buttons
        btn_frame = tk.Frame(self.root, bg="#0f172a", padx=15, pady=5)
        btn_frame.pack(fill="x")

        self.btn_flash = tk.Button(btn_frame, text="🚀 Grabar Firmware al ESP32", command=self.start_flash,
                                   bg="#059669", fg="white", font=("Segoe UI", 11, "bold"), relief="flat", pady=7, cursor="hand2")
        self.btn_flash.pack(side="left", fill="x", expand=True, padx=4)

        self.btn_monitor = tk.Button(btn_frame, text="📊 Iniciar Monitor Serial", command=self.toggle_monitor,
                                     bg="#2563eb", fg="white", font=("Segoe UI", 11, "bold"), relief="flat", pady=7, cursor="hand2")
        self.btn_monitor.pack(side="right", fill="x", expand=True, padx=4)

        # Console Output
        log_frame = tk.Frame(self.root, bg="#0f172a", padx=15, pady=8)
        log_frame.pack(fill="both", expand=True)

        self.log_text = scrolledtext.ScrolledText(log_frame, bg="#020617", fg="#38bdf8", 
                                                 font=("Consolas", 9), insertbackground="white")
        self.log_text.pack(fill="both", expand=True)

        # Status Bar
        self.status_lbl = tk.Label(self.root, text="Listo.", bg="#1e293b", fg="#94a3b8", font=("Segoe UI", 8), anchor="w", padx=10, pady=3)
        self.status_lbl.pack(fill="x", side="bottom")

    def log(self, text):
        self.log_text.insert(tk.END, text + "\n")
        self.log_text.see(tk.END)

    def refresh_ports(self):
        ports = [p.device for p in serial.tools.list_ports.comports()]
        self.port_combo["values"] = ports
        if "COM5" in ports:
            self.port_combo.set("COM5")
        elif ports:
            self.port_combo.set(ports[0])
        else:
            self.port_combo.set("")
        self.status_lbl.config(text=f"Puertos detectados: {len(ports)}")

    def unlock_port(self):
        self.stop_monitor()
        # Cerrar procesos fantasmas si los hay
        os.system("taskkill /F /IM arduino-cli.exe >nul 2>&1")
        self.log("\n[INFO] Se liberaron los procesos seriales. Puerto listo.")
        self.status_lbl.config(text="Puerto liberado.")

    def start_flash(self):
        port = self.port_combo.get()
        if not port:
            messagebox.showwarning("Aviso", "Por favor selecciona un puerto COM.")
            return

        self.stop_monitor()
        self.btn_flash.config(state="disabled", text="⏳ Grabando...")
        self.log("\n" + "="*50)
        self.log(f"[*] Iniciando compilación y subida nativa en {port}...")
        self.log("="*50)

        threading.Thread(target=self._run_flash_worker, args=(port,), daemon=True).start()

    def _run_flash_worker(self, port):
        cmd = [
            ARDUINO_CLI, "compile", "--upload",
            "-p", port,
            "--fqbn", "esp32:esp32:esp32:PartitionScheme=huge_app",
            SKETCH_PATH
        ]
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, universal_newlines=True)
            for line in p.stdout:
                clean_line = line.strip()
                if clean_line:
                    self.root.after(0, self.log, clean_line)
            p.wait()

            if p.returncode == 0:
                self.root.after(0, self.log, "\n🎉 ¡FIRMWARE GRABADO CON EXITO AL 100%!")
                self.root.after(0, self.status_lbl.config, {"text": "Grabación exitosa."})
            else:
                self.root.after(0, self.log, f"\n❌ Error al grabar (Código {p.returncode})")
                self.root.after(0, self.status_lbl.config, {"text": "Fallo en la grabación."})
        except Exception as e:
            self.root.after(0, self.log, f"[ERROR EXCEPCION]: {e}")
        finally:
            self.root.after(0, self.btn_flash.config, {"state": "normal", "text": "🚀 Grabar Firmware al ESP32"})

    def toggle_monitor(self):
        if self.is_monitoring:
            self.stop_monitor()
        else:
            self.start_monitor()

    def start_monitor(self):
        port = self.port_combo.get()
        if not port:
            messagebox.showwarning("Aviso", "Selecciona un puerto COM.")
            return

        try:
            self.serial_conn = serial.Serial(port, 115200, timeout=0.1)
            self.is_monitoring = True
            self.btn_monitor.config(text="⏹ Detener Monitor", bg="#dc2626")
            self.log(f"\n[MONITOR] Conectado a {port} a 115200 baud.")
            threading.Thread(target=self._read_serial_worker, daemon=True).start()
        except Exception as e:
            self.log(f"[ERROR MONITOR]: {e}")

    def stop_monitor(self):
        self.is_monitoring = False
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
        self.btn_monitor.config(text="📊 Iniciar Monitor Serial", bg="#2563eb")
        self.status_lbl.config(text="Monitor detenido. Puerto libre.")

    def _read_serial_worker(self):
        while self.is_monitoring and self.serial_conn and self.serial_conn.is_open:
            try:
                line = self.serial_conn.readline()
                if line:
                    decoded = line.decode('utf-8', errors='replace').strip()
                    if decoded:
                        self.root.after(0, self.log, decoded)
            except:
                break

if __name__ == "__main__":
    root = tk.Tk()
    app = VitalSyncFlasherApp(root)
    root.mainloop()
