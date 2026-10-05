"""USB command bridge tests: no serial port is opened."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gateway


class GatewayCommandTests(unittest.TestCase):
    def test_valid_command_sent_once_and_new_command_sent(self):
        ser = Mock()
        ser.write.side_effect = lambda data: len(data)
        payload = {"comando": {"accion": "grabar", "id": "ABC12345"}}
        last = gateway.reenviar_orden(payload, ser, None)
        self.assertEqual(last, "abc12345")
        self.assertEqual(gateway.reenviar_orden(payload, ser, last), last)
        ser.write.assert_called_once_with(b"REC_abc12345\n")
        payload["comando"]["id"] = "22222222"
        self.assertEqual(gateway.reenviar_orden(payload, ser, last), "22222222")
        self.assertEqual(ser.write.call_count, 2)

    def test_invalid_orders_do_not_write(self):
        ser = Mock()
        for payload in (None, {}, {"comando": None}, {"comando": "grabar"},
                        {"comando": {"accion": "other", "id": "11111111"}},
                        {"comando": {"accion": "grabar", "id": "x\nRESET"}},
                        {"comando": {"accion": "grabar", "id": 123}}):
            self.assertEqual(gateway.reenviar_orden(payload, ser, "last"), "last")
        ser.write.assert_not_called()

    def test_short_write_does_not_accept_order(self):
        ser = Mock()
        ser.write.return_value = 1
        with self.assertRaises(IOError):
            gateway.reenviar_orden({"comando": {"accion": "grabar", "id": "11111111"}}, ser, None)

    def test_successful_telemetry_response_delivers_command(self):
        response = Mock(status_code=200)
        response.json.return_value = {"comando": {"accion": "grabar", "id": "11111111"}}
        callback = Mock()
        with patch.object(gateway, "http_session") as session:
            session.post.return_value = response
            self.assertTrue(gateway.reenviar_al_backend('{"bpm": 78}', callback))
        callback.assert_called_once_with(response.json.return_value)

    def test_rejected_telemetry_never_delivers_command(self):
        callback = Mock()
        with patch.object(gateway, "http_session") as session:
            session.post.return_value = Mock(status_code=503)
            self.assertFalse(gateway.reenviar_al_backend('{}', callback))
        callback.assert_not_called()


if __name__ == "__main__":
    unittest.main()
