type FabricaContextoAudio = () => AudioContext;

export class ReproductorWebAudio {
  private contexto: AudioContext | null = null;
  private fuente: AudioBufferSourceNode | null = null;
  private generacion = 0;
  private readonly crear_contexto: FabricaContextoAudio;

  constructor(crear_contexto: FabricaContextoAudio = () => new AudioContext()) {
    this.crear_contexto = crear_contexto;
  }

  async desbloquear(): Promise<void> {
    const contexto = this.obtener_contexto();
    if (contexto.state === "suspended") await contexto.resume();
  }

  async reproducir(datos: ArrayBuffer, al_terminar: () => void, al_iniciar?: (duracion_segundos: number) => void): Promise<boolean> {
    const generacion = ++this.generacion;
    const audio = await this.decodificar(datos);
    if (generacion !== this.generacion) return false;
    return this.iniciar_buffer(audio, generacion, al_terminar, al_iniciar);
  }

  async decodificar(datos: ArrayBuffer): Promise<AudioBuffer> {
    const contexto = this.obtener_contexto();
    if (contexto.state === "suspended") await contexto.resume();
    return contexto.decodeAudioData(datos.slice(0));
  }

  async reproducir_buffer(audio: AudioBuffer, al_terminar: () => void, al_iniciar?: (duracion_segundos: number) => void): Promise<boolean> {
    const contexto = this.obtener_contexto();
    const generacion = ++this.generacion;
    if (contexto.state === "suspended") await contexto.resume();
    return this.iniciar_buffer(audio, generacion, al_terminar, al_iniciar);
  }

  private iniciar_buffer(audio: AudioBuffer, generacion: number, al_terminar: () => void, al_iniciar?: (duracion_segundos: number) => void): boolean {
    const contexto = this.obtener_contexto();
    if (generacion !== this.generacion) return false;
    this.detener_fuente();
    const fuente = contexto.createBufferSource();
    fuente.buffer = audio;
    fuente.connect(contexto.destination);
    fuente.onended = () => {
      if (this.fuente !== fuente || generacion !== this.generacion) return;
      fuente.disconnect();
      this.fuente = null;
      al_terminar();
    };
    this.fuente = fuente;
    al_iniciar?.(audio.duration);
    fuente.start();
    return true;
  }

  detener(): void {
    this.generacion += 1;
    this.detener_fuente();
  }

  private obtener_contexto(): AudioContext {
    this.contexto ??= this.crear_contexto();
    return this.contexto;
  }

  private detener_fuente(): void {
    const fuente = this.fuente;
    this.fuente = null;
    if (!fuente) return;
    fuente.onended = null;
    try { fuente.stop(); } catch { /* La fuente puede haber terminado antes. */ }
    fuente.disconnect();
  }
}
