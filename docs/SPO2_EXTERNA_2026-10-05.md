# SpO2 de un oxímetro externo

En el paso **Pulso**, debajo de la lectura del MAX30102, selecciona **Agregar SpO2 externa**. Escribe el porcentaje que muestra el otro oxímetro y, opcionalmente, su marca o nombre. **Guardar SpO2 externa** registra la lectura en el paciente abierto.

- El formulario parte vacío. No completa un porcentaje por defecto.
- Admite porcentajes mayores que cero y hasta 100, con punto o coma decimal.
- Se muestra como **Ingreso manual · externo**, con equipo y fecha. No se convierte en telemetría del ESP32 ni cambia sus indicadores de calibración.
- Durante 15 minutos se usa con prioridad para la valoración. Es una ventana de actualidad del software, no una certificación clínica del equipo. Después se conserva visible como **Lectura anterior** y deja de usarse como oxígeno actual.
- **Actualizar SpO2 externa** pide un porcentaje nuevo; **Retirar SpO2 externa** la excluye de la valoración. La base conserva los registros anteriores y las retiradas.
- La entrada funciona sin Bluetooth ni ESP32; requiere conexión con el backend actualizado para guardar y consultar el dato.
- El asistente recibe `oximetria_externa`, con `source: manual_external`, fecha y estado de actualidad. El informe PDF la identifica en una sección propia.

## API y almacenamiento

`GET /api/clinical/external-spo2/{session_id}` devuelve `{"reading": null}` o una lectura con valor, equipo, fecha, origen y `active`.

`POST /api/clinical/external-spo2/{session_id}` recibe `{"value": 95, "device_name": "Oxímetro externo"}`. La fecha se establece en el servidor. El nombre es opcional. Valores imposibles, booleanos, números no finitos y campos extra se rechazan con HTTP 422.

`DELETE /api/clinical/external-spo2/{session_id}` registra la retirada. Los registros se guardan por sesión en la tabla `external_spo2`; no modifican `vitals_log`. La tabla se crea automáticamente al iniciar el backend actualizado. No se necesita cambiar el firmware para esta opción.

## Verificación

- Backend: persistencia, aislamiento entre pacientes, rechazo de entradas, prioridad frente a telemetría, caducidad, actualización, retirada, historial/archivo, contexto de IA y PDF.
- Navegador en móvil y escritorio: entrada inválida, guardado con coma decimal, recarga, cambio de paciente y retirada.
- Web exportada y TypeScript comprobado. Las pruebas usan datos sintéticos en una base aislada; no validan la exactitud clínica de un oxímetro físico.
