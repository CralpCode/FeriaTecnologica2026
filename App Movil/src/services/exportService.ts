import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { VitalsHistoryPoint, AIAnalysisReport } from '../types/vitals';
import { API_CONFIG } from '../config/api';

export interface ExportDataParams {
  metricKey?: 'heartRate' | 'bloodOxygen' | 'hrv' | 'stressLevel';
  history?: VitalsHistoryPoint[];
  metricName?: string;
  metricUnit?: string;
  selectedRange: string;
  aiReport?: AIAnalysisReport | null;
}

export class ExportService {
  /**
   * Helper para guardar directamente en el almacenamiento del teléfono en Móvil (Android/iOS)
   */
  private static async saveFileDirectlyOnMobile(
    tempUri: string,
    filename: string,
    mimeType: string,
    uti: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 1. En Android: Guardar directamente en la carpeta seleccionada (Descargas / Storage) vía StorageAccessFramework
      if (Platform.OS === 'android' && FileSystem.StorageAccessFramework) {
        try {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
              permissions.directoryUri,
              filename,
              mimeType
            );
            const base64Data = await FileSystem.readAsStringAsync(tempUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.writeAsStringAsync(fileUri, base64Data, {
              encoding: FileSystem.EncodingType.Base64,
            });
            return { success: true, message: `Archivo guardado en tu dispositivo: ${filename}` };
          }
        } catch (safErr) {
          console.log('[ExportService] SAF no disponible o cancelado, usando guardado permanente:', safErr);
        }
      }

      // 2. Guardar permanentemente en documentDirectory del dispositivo
      const docUri = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({ from: tempUri, to: docUri });

      // 3. Compartir solo como fallback si el usuario lo necesita
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(docUri, {
          mimeType,
          dialogTitle: `Guardar ${filename}`,
          UTI: uti,
        });
        return { success: true, message: `Archivo guardado en el teléfono: ${filename}` };
      }

      return { success: true, message: `Archivo guardado en: ${filename}` };
    } catch (err: any) {
      console.error('[ExportService] Error al guardar en móvil:', err);
      return { success: false, message: `Error al guardar en el teléfono: ${err?.message || err}` };
    }
  }

  /**
   * Helper para descargar archivos en Chrome y navegadores Web de forma 100% limpia y segura
   */
  private static downloadBlobOnWeb(blob: Blob, filename: string) {
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = blobUrl;
    link.download = filename;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();

    // Limpieza segura tras 60 segundos para permitir que Chrome complete la escritura en disco
    setTimeout(() => {
      try {
        if (link.parentNode) {
          document.body.removeChild(link);
        }
        window.URL.revokeObjectURL(blobUrl);
      } catch (e) {}
    }, 60000);
  }

  /**
   * 1. EXPORTAR A EXCEL (.XLSX REAL DESDE LA BASE DE DATOS SQLITE)
   */
  static async exportToExcel(params: ExportDataParams): Promise<{ success: boolean; message: string }> {
    try {
      const { selectedRange } = params;
      const downloadUrl = `${API_CONFIG.BASE_URL}/api/export/excel?range=${selectedRange}`;
      const filename = `SpiroScan_Telemetria_${selectedRange}.xlsx`;

      if (Platform.OS === 'web') {
        // En Web, descarga directa y limpia del libro Excel .xlsx
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`El servidor respondió con código ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        this.downloadBlobOnWeb(blob, filename);

        return { success: true, message: `Libro Excel descargado con éxito: ${filename}` };
      } else {
        // En Móvil, descargar y guardar directamente en almacenamiento
        const tempUri = `${FileSystem.cacheDirectory}${filename}`;
        const downloadRes = await FileSystem.downloadAsync(downloadUrl, tempUri);

        if (downloadRes.status !== 200) {
          throw new Error(`Servidor respondió con código ${downloadRes.status}`);
        }

        return await this.saveFileDirectlyOnMobile(
          downloadRes.uri,
          filename,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'com.microsoft.excel.xlsx'
        );
      }
    } catch (error: any) {
      console.error('[ExportService] Excel Error:', error);
      return { success: false, message: `Error al exportar Excel: ${error?.message || error}` };
    }
  }

  /**
   * 2. EXPORTAR A PNG (IMAGEN GRÁFICA REAL DESDE MOTOR PYTHON MATPLOTLIB & BD)
   */
  static async exportToPng(params: ExportDataParams): Promise<{ success: boolean; message: string }> {
    try {
      const { selectedRange, metricKey = 'heartRate' } = params;
      const downloadUrl = `${API_CONFIG.BASE_URL}/api/export/png?metric=${metricKey}&range=${selectedRange}`;
      const filename = `SpiroScan_Grafica_${metricKey}_${selectedRange}.png`;

      if (Platform.OS === 'web') {
        // En Web, descarga limpia del PNG generado por Python
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`El servidor respondió con código ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer], { type: 'image/png' });
        this.downloadBlobOnWeb(blob, filename);

        return { success: true, message: `Gráfica PNG descargada con éxito: ${filename}` };
      } else {
        // En Móvil, descargar PNG y guardar directamente en almacenamiento
        const tempUri = `${FileSystem.cacheDirectory}${filename}`;
        const downloadRes = await FileSystem.downloadAsync(downloadUrl, tempUri);

        if (downloadRes.status !== 200) {
          throw new Error(`Servidor respondió con código ${downloadRes.status}`);
        }

        return await this.saveFileDirectlyOnMobile(
          downloadRes.uri,
          filename,
          'image/png',
          'public.png'
        );
      }
    } catch (error: any) {
      console.error('[ExportService] PNG Error:', error);
      return { success: false, message: `Error al exportar PNG: ${error?.message || error}` };
    }
  }

  /**
   * 3. EXPORTAR A PDF (REPORTE CLÍNICO HOSPITALARIO NATIVO .PDF)
   */
  static async exportToPdf(params: ExportDataParams): Promise<{ success: boolean; message: string }> {
    try {
      const { selectedRange } = params;
      const downloadUrl = `${API_CONFIG.BASE_URL}/api/export/pdf?range=${selectedRange}`;
      const filename = `SpiroScan_Reporte_Clinico_${selectedRange}.pdf`;

      if (Platform.OS === 'web') {
        // En Web, descarga directa del documento binario .PDF
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`El servidor respondió con código ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer], { type: 'application/pdf' });
        this.downloadBlobOnWeb(blob, filename);

        return { success: true, message: `Informe PDF descargado con éxito: ${filename}` };
      } else {
        // En Móvil, descargar PDF y guardar directamente en almacenamiento
        const tempUri = `${FileSystem.cacheDirectory}${filename}`;
        const downloadRes = await FileSystem.downloadAsync(downloadUrl, tempUri);

        if (downloadRes.status !== 200) {
          throw new Error(`Servidor respondió con código ${downloadRes.status}`);
        }

        return await this.saveFileDirectlyOnMobile(
          downloadRes.uri,
          filename,
          'application/pdf',
          'com.adobe.pdf'
        );
      }
    } catch (error: any) {
      console.error('[ExportService] PDF Error:', error);
      return { success: false, message: `Error al generar PDF: ${error?.message || error}` };
    }
  }
}
