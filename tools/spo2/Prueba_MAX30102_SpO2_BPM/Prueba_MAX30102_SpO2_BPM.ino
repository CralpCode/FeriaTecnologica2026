// ESP32 + MAX30102. Un solo archivo, sin librerias externas.
// SDA=21, SCL=22, I2C=100 kHz. Monitor serial=115200.
// Calcula candidatos SpO2 y BPM; los indicadores del algoritmo no prueban exactitud.
#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// Comprobaciones de senal: limites de ingenieria, no calibracion clinica.
#include <stdint.h>

// Engineering signal checks at the existing 25 Hz / 100 sample window.
// These checks do not establish the calibration of the optical assembly.
struct SpO2Signal {
  float ratio = 0;
  float pulse_bpm = 0;
  float ratio_mad_fraction = 0;
  float interval_cv = 0;
  float min_correlation = 0;
  uint8_t cycles = 0;
  bool quality_valid = false;
  const char* status = "insufficient_samples";
};

SpO2Signal spiroscan_analyze_spo2(const uint32_t* ir, const uint32_t* red, int count);
// Cross-check two AC/DC estimators on correlated cycles; does not convert RMS
// through the peak calibration table. Twenty percent is an engineering limit.
bool spiroscan_spo2_ratios_agree(float reference_ratio, float cycle_ratio);


const uint8_t SENSOR = 0x57;
bool listo = false;
bool mostrarRaw = false;
uint32_t secuencia25 = 0, erroresI2C = 0;
uint8_t ventanasEstables = 0;
int32_t ultimosSpO2[3] = {};
uint32_t ultimaMuestra = 0, ultimoAviso = 0;
uint32_t rojos[100], infrarrojos[100], sumaRojo = 0, sumaIR = 0;
uint16_t muestrasVentana = 0;
uint8_t muestrasPromedio = 0;
void spiroscan_oxygen_saturation(uint32_t*, int32_t, uint32_t*, int32_t*, int8_t*, int32_t*, int8_t*);
float spiroscan_reference_ratio();

void reiniciarVentana() {
  ventanasEstables = 0;
  muestrasVentana = 0;
  muestrasPromedio = 0;
  sumaRojo = sumaIR = 0;
}

void agregarMuestra(uint32_t rojo, uint32_t ir) {
  // El sensor entrega 100 pares/s (400 Hz / promedio hardware 4).
  // Otro promedio de 4 entrega los 25 Hz que espera MAXREFDES117.
  sumaRojo += rojo;
  sumaIR += ir;
  if (++muestrasPromedio < 4) return;
  rojos[muestrasVentana] = sumaRojo / 4;
  infrarrojos[muestrasVentana] = sumaIR / 4;
  ++secuencia25;
  if (mostrarRaw) Serial.printf("RAW25,%lu,%lu,%lu\n",
      (unsigned long)secuencia25, (unsigned long)rojos[muestrasVentana],
      (unsigned long)infrarrojos[muestrasVentana]);
  sumaRojo = sumaIR = 0;
  muestrasPromedio = 0;
  if (++muestrasVentana < 100) return;

  int32_t spo2 = -999, bpm = -999;
  int8_t spo2OK = 0, bpmOK = 0;
  spiroscan_oxygen_saturation(infrarrojos, 100, rojos, &spo2, &spo2OK, &bpm, &bpmOK);
  SpO2Signal senal = spiroscan_analyze_spo2(infrarrojos, rojos, 100);
  float r = spiroscan_reference_ratio();
  bool pulsoCoherente = senal.quality_valid && bpmOK &&
      fabsf(bpm - senal.pulse_bpm) <= 0.20f * senal.pulse_bpm;
  bool candidatoAceptable = senal.quality_valid && spo2OK &&
      spo2 >= 70 && spo2 <= 100 &&
      spiroscan_spo2_ratios_agree(r, senal.ratio) && pulsoCoherente;
  const char* motivo = senal.status;
  bool mostrarSpO2 = false;
  if (candidatoAceptable) {
    if (ventanasEstables < 3) ultimosSpO2[ventanasEstables++] = spo2;
    else {
      ultimosSpO2[0] = ultimosSpO2[1];
      ultimosSpO2[1] = ultimosSpO2[2];
      ultimosSpO2[2] = spo2;
    }
    motivo = "esperando_estabilidad";
    if (ventanasEstables == 3) {
      int32_t menor = ultimosSpO2[0], mayor = menor;
      for (uint8_t i = 1; i < 3; ++i) {
        if (ultimosSpO2[i] < menor) menor = ultimosSpO2[i];
        if (ultimosSpO2[i] > mayor) mayor = ultimosSpO2[i];
      }
      mostrarSpO2 = mayor - menor <= 2;
      motivo = mostrarSpO2 ? "controles_superados_sin_calibracion" : "SpO2_inestable";
    }
  } else {
    ventanasEstables = 0;
    if (senal.quality_valid) {
      if (!spo2OK) motivo = "sin_calculo_o_fuera_tabla";
      else if (spo2 < 70 || spo2 > 100) motivo = "candidato_fuera_rango_de_prueba";
      else if (!spiroscan_spo2_ratios_agree(r, senal.ratio)) motivo = "estimadores_de_R_discrepan";
      else motivo = "estimadores_de_pulso_discrepan";
    }
  }
  Serial.print("SpO2_estimada:");
  if (mostrarSpO2) Serial.print(spo2); else Serial.print("--");
  Serial.print(" | BPM_estimado:");
  if (pulsoCoherente) Serial.print(senal.pulse_bpm, 1); else Serial.print("--");
  Serial.printf(" | motivo:%s | candidato_SpO2:%ld | alg_SpO2:%d | candidato_BPM:%ld | alg_BPM:%d"
                " | R_ref:%.3f | R_ciclos:%.3f | ciclos:%u | BPM_ciclos:%.1f | I2C_errores:%lu\n",
                motivo, (long)spo2, (int)spo2OK, (long)bpm, (int)bpmOK,
                r, senal.ratio, (unsigned)senal.cycles, senal.pulse_bpm,
                (unsigned long)erroresI2C);
  // Ventana de cuatro segundos, actualizada cada segundo.
  for (uint8_t i = 25; i < 100; i++) {
    rojos[i - 25] = rojos[i];
    infrarrojos[i - 25] = infrarrojos[i];
  }
  muestrasVentana = 75;
}

bool escribir(uint8_t registro, uint8_t valor) {
  Wire.beginTransmission(SENSOR);
  Wire.write(registro);
  Wire.write(valor);
  bool ok = Wire.endTransmission() == 0;
  if (!ok) ++erroresI2C;
  return ok;
}

bool leer(uint8_t registro, uint8_t* datos, uint8_t cantidad) {
  Wire.beginTransmission(SENSOR);
  Wire.write(registro);
  if (Wire.endTransmission(false) != 0) { ++erroresI2C; return false; }
  if (Wire.requestFrom(SENSOR, cantidad) != cantidad || Wire.available() != cantidad) {
    ++erroresI2C;
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < cantidad; i++) datos[i] = Wire.read();
  return true;
}

bool limpiarFIFO() {
  return escribir(0x04, 0) && escribir(0x05, 0) && escribir(0x06, 0);
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);
  delay(500);
  Serial.println("PRUEBA SpO2 + BPM CALIDAD 2026-10-05 - 115200 BAUDIOS");
  Wire.begin(21, 22, 100000);
  Wire.setTimeOut(30);

  uint8_t id = 0;
  if (!leer(0xFF, &id, 1) || id != 0x15) {
    Serial.println("ERROR: no se reconoce el sensor en 0x57. Revisar conexiones.");
    return;
  }
  if (!escribir(0x09, 0x40)) {
    Serial.println("ERROR I2C: no se pudo iniciar el reset.");
    return;
  }
  uint32_t inicio = millis();
  uint8_t modo = 0x40;
  while (modo & 0x40) {
    if (!leer(0x09, &modo, 1) || millis() - inicio > 1000) {
      Serial.println("ERROR: reset del sensor.");
      return;
    }
    delay(1);
  }
  // Mismos ajustes opticos de la prueba anterior:
  // promedio 4, ADC 4096, 400 Hz, 411 us, LED rojo/IR 0x35.
  listo = escribir(0x08, 0x5F) && escribir(0x0A, 0x2F)
       && escribir(0x0C, 0x35) && escribir(0x0D, 0x35)
       && limpiarFIFO() && escribir(0x09, 0x03);
  Serial.println(listo ? "LISTO. Dedo quieto. Primer calculo en unos 4 segundos; luego cada segundo."
                       : "ERROR: configuracion I2C.");
  Serial.println("alg=1: solo candidato, NO confirma exactitud. -999: sin calculo.");
  Serial.println("SpO2_estimada=--: no supera controles o aun espera estabilidad; no es cero.");
  Serial.println("Estimaciones experimentales, sin calibracion. Captura continua, sin START.");
  Serial.println("Enviar RAW con nueva linea activa/desactiva RAW25,secuencia,rojo,IR.");
  ultimaMuestra = millis();
}

void loop() {
  if (Serial.available()) {
    String comando = Serial.readStringUntil('\n');
    comando.trim(); comando.toUpperCase();
    if (comando == "RAW") {
      mostrarRaw = !mostrarRaw;
      Serial.println(mostrarRaw ? "RAW activado: RAW25,secuencia,rojo,IR" : "RAW desactivado");
    }
  }
  if (!listo) { delay(100); return; }
  uint8_t punteros[3], datos[6];
  if (!leer(0x04, punteros, 3)) {
    if (millis() - ultimoAviso >= 1000) {
      Serial.println("ERROR I2C: no se pudo leer el FIFO.");
      ultimoAviso = millis();
    }
    reiniciarVentana();
    listo = limpiarFIFO();
    delay(10);
    return;
  }
  if (punteros[1] != 0) {
    Serial.println("AVISO: FIFO desbordado; reiniciando muestras.");
    reiniciarVentana();
    listo = limpiarFIFO();
    return;
  }
  uint8_t cantidad = (punteros[0] - punteros[2]) & 0x1F;
  for (uint8_t i = 0; i < cantidad; i++) {
    if (!leer(0x07, datos, 6)) {
      Serial.println("ERROR I2C: muestra incompleta, descartada.");
      reiniciarVentana();
      listo = limpiarFIFO();
      return;
    }
    uint32_t rojo = (((uint32_t)datos[0] << 16) | ((uint32_t)datos[1] << 8) | datos[2]) & 0x3FFFF;
    uint32_t ir = (((uint32_t)datos[3] << 16) | ((uint32_t)datos[4] << 8) | datos[5]) & 0x3FFFF;
    if (millis() - ultimaMuestra > 250) reiniciarVentana();
    ultimaMuestra = millis();
    if (rojo == 0x3FFFF || ir == 0x3FFFF) {
      reiniciarVentana();
      if (millis() - ultimoAviso >= 1000) {
        Serial.println("AVISO: ADC saturado; descartando ventana.");
        ultimoAviso = millis();
      }
      continue;
    }
    agregarMuestra(rojo, ir);
  }
  if (millis() - ultimaMuestra > 2000 && millis() - ultimoAviso >= 1000) {
    Serial.println("AVISO: el sensor no entrega muestras nuevas.");
    ultimoAviso = millis();
  }
  delay(2);
}

// Algoritmo y auxiliares integrados para poder copiar SOLO este archivo.
/** \file algorithm.h ******************************************************
*
* Project: MAXREFDES117#
* Filename: algorithm.h
* Description: This module is the heart rate/SpO2 calculation algorithm header file
*
* Revision History:
*\n 1-18-2016 Rev 01.00 SK Initial release.
*\n
*
* --------------------------------------------------------------------
*
* This code follows the following naming conventions:
*
*\n char              ch_pmod_value
*\n char (array)      s_pmod_s_string[16]
*\n float             f_pmod_value
*\n int32_t           n_pmod_value
*\n int32_t (array)   an_pmod_value[16]
*\n int16_t           w_pmod_value
*\n int16_t (array)   aw_pmod_value[16]
*\n uint16_t          uw_pmod_value
*\n uint16_t (array)  auw_pmod_value[16]
*\n uint8_t           uch_pmod_value
*\n uint8_t (array)   auch_pmod_buffer[16]
*\n uint32_t          un_pmod_value
*\n int32_t *         pn_pmod_value
*
* ------------------------------------------------------------------------- */
/*******************************************************************************
* Copyright (C) 2015 Maxim Integrated Products, Inc., All Rights Reserved.
*
* Permission is hereby granted, free of charge, to any person obtaining a
* copy of this software and associated documentation files (the "Software"),
* to deal in the Software without restriction, including without limitation
* the rights to use, copy, modify, merge, publish, distribute, sublicense,
* and/or sell copies of the Software, and to permit persons to whom the
* Software is furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included
* in all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
* OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
* IN NO EVENT SHALL MAXIM INTEGRATED BE LIABLE FOR ANY CLAIM, DAMAGES
* OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
* ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
* OTHER DEALINGS IN THE SOFTWARE.
*
* Except as contained in this notice, the name of Maxim Integrated
* Products, Inc. shall not be used except as stated in the Maxim Integrated
* Products, Inc. Branding Policy.
*
* The mere transfer of this software does not imply any licenses
* of trade secrets, proprietary technology, copyrights, patents,
* trademarks, maskwork rights, or any other form of intellectual
* property whatsoever. Maxim Integrated Products, Inc. retains all
* ownership rights.
*******************************************************************************
*/
#ifndef SPO2_ALGORITHM_H_
#define SPO2_ALGORITHM_H_

#include <Arduino.h>

#define FreqS 25    //sampling frequency
#define BUFFER_SIZE (FreqS * 4)
#define MA4_SIZE 4 // DONOT CHANGE
//#define min(x,y) ((x) < (y) ? (x) : (y)) //Defined in Arduino.h

//uch_spo2_table is approximated as  -45.060*ratioAverage* ratioAverage + 30.354 *ratioAverage + 94.845 ;
const uint8_t uch_spo2_table[184]={ 95, 95, 95, 96, 96, 96, 97, 97, 97, 97, 97, 98, 98, 98, 98, 98, 99, 99, 99, 99,
              99, 99, 99, 99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
              100, 100, 100, 100, 99, 99, 99, 99, 99, 99, 99, 99, 98, 98, 98, 98, 98, 98, 97, 97,
              97, 97, 96, 96, 96, 96, 95, 95, 95, 94, 94, 94, 93, 93, 93, 92, 92, 92, 91, 91,
              90, 90, 89, 89, 89, 88, 88, 87, 87, 86, 86, 85, 85, 84, 84, 83, 82, 82, 81, 81,
              80, 80, 79, 78, 78, 77, 76, 76, 75, 74, 74, 73, 72, 72, 71, 70, 69, 69, 68, 67,
              66, 66, 65, 64, 63, 62, 62, 61, 60, 59, 58, 57, 56, 56, 55, 54, 53, 52, 51, 50,
              49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 31, 30, 29,
              28, 27, 26, 25, 23, 22, 21, 20, 19, 17, 16, 15, 14, 12, 11, 10, 9, 7, 6, 5,
              3, 2, 1 } ;
static  int32_t an_x[ BUFFER_SIZE]; //ir
static  int32_t an_y[ BUFFER_SIZE]; //red


#if defined(__AVR_ATmega328P__) || defined(__AVR_ATmega168__)
//Arduino Uno doesn't have enough SRAM to store 100 samples of IR led data and red led data in 32-bit format
//To solve this problem, 16-bit MSB of the sampled data will be truncated.  Samples become 16-bit data.
void maxim_heart_rate_and_oxygen_saturation(uint16_t *pun_ir_buffer, int32_t n_ir_buffer_length, uint16_t *pun_red_buffer, int32_t *pn_spo2, int8_t *pch_spo2_valid, int32_t *pn_heart_rate, int8_t *pch_hr_valid);
#else
void maxim_heart_rate_and_oxygen_saturation(uint32_t *pun_ir_buffer, int32_t n_ir_buffer_length, uint32_t *pun_red_buffer, int32_t *pn_spo2, int8_t *pch_spo2_valid, int32_t *pn_heart_rate, int8_t *pch_hr_valid);
#endif

void maxim_find_peaks(int32_t *pn_locs, int32_t *n_npks,  int32_t  *pn_x, int32_t n_size, int32_t n_min_height, int32_t n_min_distance, int32_t n_max_num);
void maxim_peaks_above_min_height(int32_t *pn_locs, int32_t *n_npks,  int32_t  *pn_x, int32_t n_size, int32_t n_min_height);
void maxim_remove_close_peaks(int32_t *pn_locs, int32_t *pn_npks, int32_t *pn_x, int32_t n_min_distance);
void maxim_sort_ascend(int32_t  *pn_x, int32_t n_size);
void maxim_sort_indices_descend(int32_t  *pn_x, int32_t *pn_indx, int32_t n_size);

#endif /* ALGORITHM_H_ */


// Derived from SparkFun MAX3010x library 1.1.2, MAXREFDES117 reference algorithm.
// Only SpO2 arithmetic is corrected; hardware and the independent beat detector stay unchanged.
/** \file algorithm.cpp ******************************************************
*
* Project: MAXREFDES117#
* Filename: algorithm.cpp
* Description: This module calculates the heart rate/SpO2 level
*
*
* --------------------------------------------------------------------
*
* This code follows the following naming conventions:
*
* char              ch_pmod_value
* char (array)      s_pmod_s_string[16]
* float             f_pmod_value
* int32_t           n_pmod_value
* int32_t (array)   an_pmod_value[16]
* int16_t           w_pmod_value
* int16_t (array)   aw_pmod_value[16]
* uint16_t          uw_pmod_value
* uint16_t (array)  auw_pmod_value[16]
* uint8_t           uch_pmod_value
* uint8_t (array)   auch_pmod_buffer[16]
* uint32_t          un_pmod_value
* int32_t *         pn_pmod_value
*
* ------------------------------------------------------------------------- */
/*******************************************************************************
* Copyright (C) 2016 Maxim Integrated Products, Inc., All Rights Reserved.
*
* Permission is hereby granted, free of charge, to any person obtaining a
* copy of this software and associated documentation files (the "Software"),
* to deal in the Software without restriction, including without limitation
* the rights to use, copy, modify, merge, publish, distribute, sublicense,
* and/or sell copies of the Software, and to permit persons to whom the
* Software is furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included
* in all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
* OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
* IN NO EVENT SHALL MAXIM INTEGRATED BE LIABLE FOR ANY CLAIM, DAMAGES
* OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
* ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
* OTHER DEALINGS IN THE SOFTWARE.
*
* Except as contained in this notice, the name of Maxim Integrated
* Products, Inc. shall not be used except as stated in the Maxim Integrated
* Products, Inc. Branding Policy.
*
* The mere transfer of this software does not imply any licenses
* of trade secrets, proprietary technology, copyrights, patents,
* trademarks, maskwork rights, or any other form of intellectual
* property whatsoever. Maxim Integrated Products, Inc. retains all
* ownership rights.
*******************************************************************************
*/

#include "Arduino.h"


static int32_t last_reference_ratio_x100 = 0;
float spiroscan_reference_ratio() { return last_reference_ratio_x100 / 100.0f; }

#if defined(__AVR_ATmega328P__) || defined(__AVR_ATmega168__)
//Arduino Uno doesn't have enough SRAM to store 100 samples of IR led data and red led data in 32-bit format
//To solve this problem, 16-bit MSB of the sampled data will be truncated.  Samples become 16-bit data.
void spiroscan_oxygen_saturation(uint16_t *pun_ir_buffer, int32_t n_ir_buffer_length, uint16_t *pun_red_buffer, int32_t *pn_spo2, int8_t *pch_spo2_valid,
                int32_t *pn_heart_rate, int8_t *pch_hr_valid)
#else
void spiroscan_oxygen_saturation(uint32_t *pun_ir_buffer, int32_t n_ir_buffer_length, uint32_t *pun_red_buffer, int32_t *pn_spo2, int8_t *pch_spo2_valid,
                int32_t *pn_heart_rate, int8_t *pch_hr_valid)
#endif
/**
* \brief        Calculate the heart rate and SpO2 level
* \par          Details
*               By detecting  peaks of PPG cycle and corresponding AC/DC of red/infra-red signal, the an_ratio for the SPO2 is computed.
*               Since this algorithm is aiming for Arm M0/M3. formaula for SPO2 did not achieve the accuracy due to register overflow.
*               Thus, accurate SPO2 is precalculated and save longo uch_spo2_table[] per each an_ratio.
*
* \param[in]    *pun_ir_buffer           - IR sensor data buffer
* \param[in]    n_ir_buffer_length      - IR sensor data buffer length
* \param[in]    *pun_red_buffer          - Red sensor data buffer
* \param[out]    *pn_spo2                - Calculated SpO2 value
* \param[out]    *pch_spo2_valid         - 1 if the calculated SpO2 value is valid
* \param[out]    *pn_heart_rate          - Calculated heart rate value
* \param[out]    *pch_hr_valid           - 1 if the calculated heart rate value is valid
*
* \retval       None
*/
{
  last_reference_ratio_x100 = 0;
  uint32_t un_ir_mean;
  int32_t k, n_i_ratio_count;
  int32_t i, n_exact_ir_valley_locs_count, n_middle_idx;
  int32_t n_th1, n_npks;
  int32_t an_ir_valley_locs[15] ;
  int32_t n_peak_interval_sum;

  int32_t n_y_ac, n_x_ac;
  int32_t n_spo2_calc;
  int32_t n_y_dc_max, n_x_dc_max;
  int32_t n_y_dc_max_idx = 0;
  int32_t n_x_dc_max_idx = 0;
  int32_t an_ratio[5], n_ratio_average;
  int64_t n_nume, n_denom; // Optical products exceed 32 bits at 18-bit ADC range.

  // calculates DC mean and subtract DC from ir
  un_ir_mean =0;
  for (k=0 ; k<n_ir_buffer_length ; k++ ) un_ir_mean += pun_ir_buffer[k] ;
  un_ir_mean =un_ir_mean/n_ir_buffer_length ;

  // remove DC and invert signal so that we can use peak detector as valley detector
  for (k=0 ; k<n_ir_buffer_length ; k++ )
    an_x[k] = -1*(pun_ir_buffer[k] - un_ir_mean) ;

  // 4 pt Moving Average
  for(k=0; k< BUFFER_SIZE-MA4_SIZE; k++){
    an_x[k]=( an_x[k]+an_x[k+1]+ an_x[k+2]+ an_x[k+3])/(int)4;
  }
  // calculate threshold
  n_th1=0;
  for ( k=0 ; k<BUFFER_SIZE ;k++){
    n_th1 +=  an_x[k];
  }
  n_th1=  n_th1/ ( BUFFER_SIZE);
  if( n_th1<30) n_th1=30; // min allowed
  if( n_th1>60) n_th1=60; // max allowed

  for ( k=0 ; k<15;k++) an_ir_valley_locs[k]=0;
  // since we flipped signal, we use peak detector as valley detector
  maxim_find_peaks( an_ir_valley_locs, &n_npks, an_x, BUFFER_SIZE, n_th1, 4, 15 );//peak_height, peak_distance, max_num_peaks
  n_peak_interval_sum =0;
  if (n_npks>=2){
    for (k=1; k<n_npks; k++) n_peak_interval_sum += (an_ir_valley_locs[k] -an_ir_valley_locs[k -1] ) ;
    n_peak_interval_sum =n_peak_interval_sum/(n_npks-1);
    *pn_heart_rate =(int32_t)( (FreqS*60)/ n_peak_interval_sum );
    *pch_hr_valid  = 1;
  }
  else  {
    *pn_heart_rate = -999; // unable to calculate because # of peaks are too small
    *pch_hr_valid  = 0;
  }

  //  load raw value again for SPO2 calculation : RED(=y) and IR(=X)
  for (k=0 ; k<n_ir_buffer_length ; k++ )  {
      an_x[k] =  pun_ir_buffer[k] ;
      an_y[k] =  pun_red_buffer[k] ;
  }

  // find precise min near an_ir_valley_locs
  n_exact_ir_valley_locs_count =n_npks;

  //using exact_ir_valley_locs , find ir-red DC andir-red AC for SPO2 calibration an_ratio
  //finding AC/DC maximum of raw

  n_ratio_average =0;
  n_i_ratio_count = 0;
  for(k=0; k< 5; k++) an_ratio[k]=0;
  for (k=0; k< n_exact_ir_valley_locs_count; k++){
    if (an_ir_valley_locs[k] > BUFFER_SIZE ){
      *pn_spo2 =  -999 ; // do not use SPO2 since valley loc is out of range
      *pch_spo2_valid  = 0;
      return;
    }
  }
  // find max between two valley locations
  // and use an_ratio betwen AC compoent of Ir & Red and DC compoent of Ir & Red for SPO2
  for (k=0; k< n_exact_ir_valley_locs_count-1; k++){
    n_y_dc_max= -16777216 ;
    n_x_dc_max= -16777216;
    if (an_ir_valley_locs[k+1]-an_ir_valley_locs[k] >3){
        for (i=an_ir_valley_locs[k]; i< an_ir_valley_locs[k+1]; i++){
          if (an_x[i]> n_x_dc_max) {n_x_dc_max =an_x[i]; n_x_dc_max_idx=i;}
          if (an_y[i]> n_y_dc_max) {n_y_dc_max =an_y[i]; n_y_dc_max_idx=i;}
      }
      n_y_ac= (an_y[an_ir_valley_locs[k+1]] - an_y[an_ir_valley_locs[k] ] )*(n_y_dc_max_idx -an_ir_valley_locs[k]); //red
      n_y_ac=  an_y[an_ir_valley_locs[k]] + n_y_ac/ (an_ir_valley_locs[k+1] - an_ir_valley_locs[k])  ;
      n_y_ac=  an_y[n_y_dc_max_idx] - n_y_ac;    // subracting linear DC compoenents from raw
      n_x_ac= (an_x[an_ir_valley_locs[k+1]] - an_x[an_ir_valley_locs[k] ] )*(n_x_dc_max_idx -an_ir_valley_locs[k]); // ir
      n_x_ac=  an_x[an_ir_valley_locs[k]] + n_x_ac/ (an_ir_valley_locs[k+1] - an_ir_valley_locs[k]);
      n_x_ac=  an_x[n_x_dc_max_idx] - n_x_ac;      // subracting linear DC compoenents from raw
      n_nume=( (int64_t)n_y_ac * n_x_dc_max)>>7 ; //prepare X100 to preserve floating value
      n_denom= ( (int64_t)n_x_ac * n_y_dc_max)>>7;
      if (n_denom>0  && n_i_ratio_count <5 &&  n_nume > 0)
      {
        an_ratio[n_i_ratio_count]= (int32_t)((n_nume*100)/n_denom); //formular is ( (int64_t)n_y_ac * n_x_dc_max) / ( (int64_t)n_x_ac * n_y_dc_max) ;
        n_i_ratio_count++;
      }
    }
  }
  // choose median value since PPG signal may varies from beat to beat
  maxim_sort_ascend(an_ratio, n_i_ratio_count);
  n_middle_idx= n_i_ratio_count/2;

  // Mediana correcta para cantidades pares e impares; sin cocientes = 0.
  if (n_i_ratio_count == 0)
    n_ratio_average = 0;
  else if (n_i_ratio_count % 2 == 0)
    n_ratio_average = (an_ratio[n_middle_idx-1] + an_ratio[n_middle_idx])/2;
  else
    n_ratio_average = an_ratio[n_middle_idx];

  last_reference_ratio_x100 = n_ratio_average;
  if( n_ratio_average>2 && n_ratio_average <184){
    n_spo2_calc= uch_spo2_table[n_ratio_average] ;
    *pn_spo2 = n_spo2_calc ;
    *pch_spo2_valid  = 1;//  float_SPO2 =  -45.060*n_ratio_average* n_ratio_average/10000 + 30.354 *n_ratio_average/100 + 94.845 ;  // for comparison with table
  }
  else{
    *pn_spo2 =  -999 ; // do not use SPO2 since signal an_ratio is out of range
    *pch_spo2_valid  = 0;
  }
}


/** \file algorithm.cpp ******************************************************
*
* Project: MAXREFDES117#
* Filename: algorithm.cpp
* Description: This module calculates the heart rate/SpO2 level
*
*
* --------------------------------------------------------------------
*
* This code follows the following naming conventions:
*
* char              ch_pmod_value
* char (array)      s_pmod_s_string[16]
* float             f_pmod_value
* int32_t           n_pmod_value
* int32_t (array)   an_pmod_value[16]
* int16_t           w_pmod_value
* int16_t (array)   aw_pmod_value[16]
* uint16_t          uw_pmod_value
* uint16_t (array)  auw_pmod_value[16]
* uint8_t           uch_pmod_value
* uint8_t (array)   auch_pmod_buffer[16]
* uint32_t          un_pmod_value
* int32_t *         pn_pmod_value
*
* ------------------------------------------------------------------------- */
/*******************************************************************************
* Copyright (C) 2016 Maxim Integrated Products, Inc., All Rights Reserved.
*
* Permission is hereby granted, free of charge, to any person obtaining a
* copy of this software and associated documentation files (the "Software"),
* to deal in the Software without restriction, including without limitation
* the rights to use, copy, modify, merge, publish, distribute, sublicense,
* and/or sell copies of the Software, and to permit persons to whom the
* Software is furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included
* in all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
* OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
* IN NO EVENT SHALL MAXIM INTEGRATED BE LIABLE FOR ANY CLAIM, DAMAGES
* OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
* ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
* OTHER DEALINGS IN THE SOFTWARE.
*
* Except as contained in this notice, the name of Maxim Integrated
* Products, Inc. shall not be used except as stated in the Maxim Integrated
* Products, Inc. Branding Policy.
*
* The mere transfer of this software does not imply any licenses
* of trade secrets, proprietary technology, copyrights, patents,
* trademarks, maskwork rights, or any other form of intellectual
* property whatsoever. Maxim Integrated Products, Inc. retains all
* ownership rights.
*******************************************************************************
*/


void maxim_find_peaks( int32_t *pn_locs, int32_t *n_npks,  int32_t  *pn_x, int32_t n_size, int32_t n_min_height, int32_t n_min_distance, int32_t n_max_num )
/**
* \brief        Find peaks
* \par          Details
*               Find at most MAX_NUM peaks above MIN_HEIGHT separated by at least MIN_DISTANCE
*
* \retval       None
*/
{
  maxim_peaks_above_min_height( pn_locs, n_npks, pn_x, n_size, n_min_height );
  maxim_remove_close_peaks( pn_locs, n_npks, pn_x, n_min_distance );
  *n_npks = min( *n_npks, n_max_num );
}

void maxim_peaks_above_min_height( int32_t *pn_locs, int32_t *n_npks,  int32_t  *pn_x, int32_t n_size, int32_t n_min_height )
/**
* \brief        Find peaks above n_min_height
* \par          Details
*               Find all peaks above MIN_HEIGHT
*
* \retval       None
*/
{
  int32_t i = 1, n_width;
  *n_npks = 0;

  while (i < n_size-1){
    if (pn_x[i] > n_min_height && pn_x[i] > pn_x[i-1]){      // find left edge of potential peaks
      n_width = 1;
      while (i+n_width < n_size && pn_x[i] == pn_x[i+n_width])  // find flat peaks
        n_width++;
      if (i+n_width < n_size && pn_x[i] > pn_x[i+n_width] && (*n_npks) < 15 ){      // find right edge of peaks
        pn_locs[(*n_npks)++] = i;
        // for flat peaks, peak location is left edge
        i += n_width+1;
      }
      else
        i += n_width;
    }
    else
      i++;
  }
}

void maxim_remove_close_peaks(int32_t *pn_locs, int32_t *pn_npks, int32_t *pn_x, int32_t n_min_distance)
/**
* \brief        Remove peaks
* \par          Details
*               Remove peaks separated by less than MIN_DISTANCE
*
* \retval       None
*/
{

  int32_t i, j, n_old_npks, n_dist;

  /* Order peaks from large to small */
  maxim_sort_indices_descend( pn_x, pn_locs, *pn_npks );

  for ( i = -1; i < *pn_npks; i++ ){
    n_old_npks = *pn_npks;
    *pn_npks = i+1;
    for ( j = i+1; j < n_old_npks; j++ ){
      n_dist =  pn_locs[j] - ( i == -1 ? -1 : pn_locs[i] ); // lag-zero peak of autocorr is at index -1
      if ( n_dist > n_min_distance || n_dist < -n_min_distance )
        pn_locs[(*pn_npks)++] = pn_locs[j];
    }
  }

  // Resort indices int32_to ascending order
  maxim_sort_ascend( pn_locs, *pn_npks );
}

void maxim_sort_ascend(int32_t  *pn_x, int32_t n_size)
/**
* \brief        Sort array
* \par          Details
*               Sort array in ascending order (insertion sort algorithm)
*
* \retval       None
*/
{
  int32_t i, j, n_temp;
  for (i = 1; i < n_size; i++) {
    n_temp = pn_x[i];
    for (j = i; j > 0 && n_temp < pn_x[j-1]; j--)
        pn_x[j] = pn_x[j-1];
    pn_x[j] = n_temp;
  }
}

void maxim_sort_indices_descend(  int32_t  *pn_x, int32_t *pn_indx, int32_t n_size)
/**
* \brief        Sort indices
* \par          Details
*               Sort indices according to descending order (insertion sort algorithm)
*
* \retval       None
*/
{
  int32_t i, j, n_temp;
  for (i = 1; i < n_size; i++) {
    n_temp = pn_indx[i];
    for (j = i; j > 0 && pn_x[n_temp] > pn_x[pn_indx[j-1]]; j--)
      pn_indx[j] = pn_indx[j-1];
    pn_indx[j] = n_temp;
  }
}





// Analisis de ciclos comunes, integrado para conservar un solo archivo.
#include <math.h>
#include <stdlib.h>

namespace {
constexpr int N = 100;
constexpr float RATE = 25.0f;
// Conservative engineering limits, not medically validated thresholds.
constexpr float MIN_CORRELATION = 0.85f;
constexpr float MAX_INTERVAL_CV = 0.20f;
constexpr float MAX_RATIO_MAD = 0.15f;
constexpr float MIN_RELATIVE_AC = 0.0002f;

float median(float* values, int count) {
  for (int i = 1; i < count; ++i) {
    float value = values[i];
    int j = i;
    while (j > 0 && values[j - 1] > value) {
      values[j] = values[j - 1]; --j;
    }
    values[j] = value;
  }
  return count % 2 ? values[count / 2] :
    (values[count / 2 - 1] + values[count / 2]) * 0.5f;
}
}

bool spiroscan_spo2_ratios_agree(float reference_ratio, float cycle_ratio) {
  return reference_ratio > 0 && cycle_ratio > 0 &&
    fabsf(reference_ratio - cycle_ratio) <= 0.20f * cycle_ratio;
}

SpO2Signal spiroscan_analyze_spo2(const uint32_t* ir, const uint32_t* red, int count) {
  SpO2Signal out;
  if (!ir || !red || count != N) return out;
  float mean = 0, slope = 0, denominator = 0;
  for (int i = 0; i < N; ++i) {
    if (ir[i] == 0 || red[i] == 0) { out.status = "no_contact"; return out; }
    if (ir[i] >= 260000 || red[i] >= 260000) {
      out.status = "optical_clipping"; return out;
    }
    mean += ir[i];
  }
  mean /= N;
  for (int i = 0; i < N; ++i) {
    float t = i - (N - 1) * 0.5f;
    slope += t * (ir[i] - mean); denominator += t * t;
  }
  slope /= denominator;
  float ac[N], smooth[N] = {}, energy = 0;
  for (int i = 0; i < N; ++i)
    ac[i] = ir[i] - mean - slope * (i - (N - 1) * 0.5f);
  for (int i = 1; i < N - 1; ++i) {
    smooth[i] = (ac[i - 1] + ac[i] + ac[i + 1]) / 3;
    energy += smooth[i] * smooth[i];
  }
  float rms = sqrtf(energy / (N - 2));
  if (rms / mean < MIN_RELATIVE_AC) { out.status = "weak_signal"; return out; }

  // Rank local valleys by their prominence on both sides. A 10-sample
  // exclusion prevents counting the dicrotic notch as another pulse.
  int candidates[N], candidate_count = 0;
  float prominence[N];
  for (int i = 2; i < N - 2; ++i) {
    if (!(smooth[i] < smooth[i - 1] && smooth[i] <= smooth[i + 1])) continue;
    float left = smooth[i], right = smooth[i];
    for (int j = i - 8; j < i; ++j)
      if (j >= 1 && smooth[j] > left) left = smooth[j];
    for (int j = i + 1; j <= i + 8; ++j)
      if (j < N - 1 && smooth[j] > right) right = smooth[j];
    float p = fminf(left, right) - smooth[i];
    if (p > 0.5f * rms) {
      candidates[candidate_count] = i; prominence[candidate_count++] = p;
    }
  }
  for (int i = 1; i < candidate_count; ++i) {
    int pos = candidates[i], j = i; float p = prominence[i];
    while (j > 0 && prominence[j - 1] < p) {
      candidates[j] = candidates[j - 1]; prominence[j] = prominence[j - 1]; --j;
    }
    candidates[j] = pos; prominence[j] = p;
  }
  int valleys[10], valley_count = 0;
  for (int i = 0; i < candidate_count && valley_count < 10; ++i) {
    bool separated = true;
    for (int j = 0; j < valley_count; ++j)
      if (abs(candidates[i] - valleys[j]) < 10) separated = false;
    if (separated) valleys[valley_count++] = candidates[i];
  }
  for (int i = 1; i < valley_count; ++i) {
    int pos = valleys[i], j = i;
    while (j > 0 && valleys[j - 1] > pos) { valleys[j] = valleys[j - 1]; --j; }
    valleys[j] = pos;
  }

  float ratios[9], intervals[9], deviations[9];
  out.min_correlation = 1;
  bool rejected_cycle = false;
  for (int k = 0; k < valley_count - 1; ++k) {
    int a = valleys[k], b = valleys[k + 1], length = b - a;
    // Complete cycles only; approximately 45-150 BPM at 25 Hz.
    if (length < 10 || length > 33) { rejected_cycle = true; continue; }
    float dc_ir = 0, dc_red = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (int i = a; i <= b; ++i) {
      float fraction = float(i - a) / length;
      // Remove a separate linear baseline in each channel over the SAME cycle.
      float x = float(ir[i]) - (float(ir[a]) + (float(ir[b]) - ir[a]) * fraction);
      float y = float(red[i]) - (float(red[a]) + (float(red[b]) - red[a]) * fraction);
      dc_ir += ir[i]; dc_red += red[i];
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    float n = float(length + 1);
    dc_ir /= n; dc_red /= n;
    float vx = fmaxf(0, sxx / n - (sx / n) * (sx / n));
    float vy = fmaxf(0, syy / n - (sy / n) * (sy / n));
    float norm_ir = sqrtf(vx) / dc_ir, norm_red = sqrtf(vy) / dc_red;
    if (norm_ir < MIN_RELATIVE_AC || norm_red < MIN_RELATIVE_AC) {
      rejected_cycle = true; continue;
    }
    float correlation = (sxy / n - sx * sy / (n * n)) / sqrtf(vx * vy);
    out.min_correlation = fminf(out.min_correlation, correlation);
    if (correlation < MIN_CORRELATION) { rejected_cycle = true; continue; }
    ratios[out.cycles] = norm_red / norm_ir;
    intervals[out.cycles] = float(length);
    ++out.cycles;
  }
  if (out.cycles == 0) { out.status = "insufficient_cycles"; return out; }
  out.ratio = median(ratios, out.cycles);
  for (int i = 0; i < out.cycles; ++i) deviations[i] = fabsf(ratios[i] - out.ratio);
  out.ratio_mad_fraction = median(deviations, out.cycles) / out.ratio;
  float interval_mean = 0, variance = 0;
  for (int i = 0; i < out.cycles; ++i) interval_mean += intervals[i];
  interval_mean /= out.cycles;
  for (int i = 0; i < out.cycles; ++i)
    variance += (intervals[i] - interval_mean) * (intervals[i] - interval_mean);
  out.interval_cv = sqrtf(variance / out.cycles) / interval_mean;
  out.pulse_bpm = RATE * 60 / interval_mean;
  if (out.cycles < 3) { out.status = "insufficient_cycles"; return out; }
  if (rejected_cycle || out.interval_cv > MAX_INTERVAL_CV ||
      out.ratio_mad_fraction > MAX_RATIO_MAD) {
    out.status = "unstable_signal"; return out;
  }
  out.quality_valid = true;
  // Range of the existing MAXREFDES117 lookup, not a fitted calibration curve.
  out.status = out.ratio > 0.02f && out.ratio < 1.84f ? "signal_ok" : "ratio_out_of_range";
  return out;
}
