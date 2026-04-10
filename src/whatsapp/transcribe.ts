import axios from "axios";
import FormData from "form-data";
import OpenAI from "openai";
import { WHATSAPP } from "../config";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function downloadAudio(mediaId: string): Promise<Buffer> {
  // 1. Obtener URL de descarga
  const mediaRes = await axios.get(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP.token}` } }
  );
  const mediaUrl: string = mediaRes.data.url;

  // 2. Descargar el audio
  const audioRes = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${WHATSAPP.token}` },
  });

  return Buffer.from(audioRes.data);
}

export async function transcribeAudio(mediaId: string, mimeType: string): Promise<string> {
  try {
    const audioBuffer = await downloadAudio(mediaId);

    // Determinar extensión del archivo
    const ext = mimeType.includes("ogg") ? "ogg" : "mp4";

    const form = new FormData();
    form.append("file", audioBuffer, { filename: `audio.${ext}`, contentType: mimeType });
    form.append("model", "whisper-1");
    form.append("language", "es");

    const response = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], `audio.${ext}`, { type: mimeType }),
      model: "whisper-1",
      language: "es",
    });

    return response.text || "";
  } catch (error) {
    console.error("[transcribe] Error transcribiendo audio:", error);
    return "";
  }
}
