#!/usr/bin/env python3
"""
VEX IQ-style 2-motor walker control for Raspberry Pi 5 + HW-095 (L298N).

Wiring (BCM GPIO numbering):
- ENA -> GPIO18   (PWM for Motor 1 speed)
- IN1 -> GPIO23   (Motor 1 direction)
- IN2 -> GPIO24   (Motor 1 direction)
- IN3 -> GPIO27   (Motor 2 direction)
- IN4 -> GPIO22   (Motor 2 direction)
- ENB -> GPIO19   (PWM for Motor 2 speed)
- L298N GND -> Pi GND
- Motor power is external and connected to the L298N power terminal.
- Motor 1 -> OUT1/OUT2, Motor 2 -> OUT3/OUT4

Run:
  python3 scripts/vex_iq_walker.py
  python3 scripts/vex_iq_walker.py --walk-speed 0.65 --turn-speed 0.45
  python3 scripts/vex_iq_walker.py --dry-run

Keyboard controls:
  W forward, S backward, A left, D right, X/Space stop, Q quit

Back-to-back mirrored mapping used by this walker:
- Forward:  motor1=+walk_speed, motor2=-walk_speed
- Backward: motor1=-walk_speed, motor2=+walk_speed
- Left:     motor1=-turn_speed, motor2=-turn_speed
- Right:    motor1=+turn_speed, motor2=+turn_speed
"""

from __future__ import annotations

import argparse
import select
import sys
import termios
import tty
from dataclasses import dataclass
from typing import Optional

# -------------------- Beginner-friendly defaults --------------------
WALK_SPEED = 0.60
TURN_SPEED = 0.45
PWM_FREQUENCY = 1000  # Hz

# L298N pin mapping (BCM)
ENA_PIN = 18
IN1_PIN = 23
IN2_PIN = 24
IN3_PIN = 27
IN4_PIN = 22
ENB_PIN = 19


@dataclass
class MotorDevices:
    ena: object
    in1: object
    in2: object
    enb: object
    in3: object
    in4: object


DEVICES: Optional[MotorDevices] = None
DRY_RUN = False


def clamp_speed(value: float) -> float:
    """Clamp signed speed to [-1.0, 1.0]."""
    return max(-1.0, min(1.0, float(value)))


def setup_gpio(dry_run: bool = False) -> None:
    """Initialize GPIO using gpiozero + lgpio backend (Pi 5 friendly)."""
    global DEVICES, DRY_RUN
    DRY_RUN = dry_run

    if DRY_RUN:
        print("[DRY-RUN] GPIO setup skipped.")
        return

    try:
        from gpiozero import OutputDevice, PWMOutputDevice
        from gpiozero.pins.lgpio import LGPIOFactory
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency. Install with:\n"
            "  pip install gpiozero rpi-lgpio"
        ) from exc

    factory = LGPIOFactory()

    DEVICES = MotorDevices(
        ena=PWMOutputDevice(ENA_PIN, frequency=PWM_FREQUENCY, pin_factory=factory),
        in1=OutputDevice(IN1_PIN, pin_factory=factory),
        in2=OutputDevice(IN2_PIN, pin_factory=factory),
        enb=PWMOutputDevice(ENB_PIN, frequency=PWM_FREQUENCY, pin_factory=factory),
        in3=OutputDevice(IN3_PIN, pin_factory=factory),
        in4=OutputDevice(IN4_PIN, pin_factory=factory),
    )
    print("GPIO initialized (gpiozero + lgpio backend).")


def set_motor(motor_index: int, signed_speed: float) -> None:
    """Set one motor by signed speed.

    signed_speed convention:
    - positive: forward for that motor wiring
    - negative: reverse for that motor wiring
    - zero: stop
    """
    s = clamp_speed(signed_speed)
    duty = abs(s)

    if DRY_RUN:
        print(f"[DRY-RUN] set_motor({motor_index}, {s:+.2f}) duty={duty:.2f}")
        return

    if DEVICES is None:
        raise RuntimeError("GPIO not initialized. Call setup_gpio() first.")

    if motor_index == 1:
        if s > 0:
            DEVICES.in1.on()
            DEVICES.in2.off()
        elif s < 0:
            DEVICES.in1.off()
            DEVICES.in2.on()
        else:
            DEVICES.in1.off()
            DEVICES.in2.off()
        DEVICES.ena.value = duty

    elif motor_index == 2:
        if s > 0:
            DEVICES.in3.on()
            DEVICES.in4.off()
        elif s < 0:
            DEVICES.in3.off()
            DEVICES.in4.on()
        else:
            DEVICES.in3.off()
            DEVICES.in4.off()
        DEVICES.enb.value = duty

    else:
        raise ValueError("motor_index must be 1 or 2")


def apply_command(name: str, m1: float, m2: float) -> None:
    """Apply command to both motors with helpful console output."""
    m1 = clamp_speed(m1)
    m2 = clamp_speed(m2)
    print(f"{name:<9} | motor1={m1:+.2f} motor2={m2:+.2f}")
    set_motor(1, m1)
    set_motor(2, m2)


def drive_forward(walk_speed: float) -> None:
    # Mirrored back-to-back mapping for straight forward motion.
    apply_command("FORWARD", +walk_speed, -walk_speed)


def drive_backward(walk_speed: float) -> None:
    apply_command("BACKWARD", -walk_speed, +walk_speed)


def turn_left(turn_speed: float) -> None:
    apply_command("LEFT", -turn_speed, -turn_speed)


def turn_right(turn_speed: float) -> None:
    apply_command("RIGHT", +turn_speed, +turn_speed)


def stop_all() -> None:
    apply_command("STOP", 0.0, 0.0)


def cleanup() -> None:
    """Always stop motors and release GPIO resources."""
    global DEVICES
    try:
        stop_all()
    except Exception:
        pass

    if not DRY_RUN and DEVICES is not None:
        DEVICES.ena.close()
        DEVICES.enb.close()
        DEVICES.in1.close()
        DEVICES.in2.close()
        DEVICES.in3.close()
        DEVICES.in4.close()
        DEVICES = None
        print("GPIO cleaned up.")


def read_key(timeout: float = 0.05) -> Optional[str]:
    ready, _, _ = select.select([sys.stdin], [], [], timeout)
    if not ready:
        return None
    return sys.stdin.read(1)


def keyboard_loop(walk_speed: float, turn_speed: float) -> None:
    """Interactive keyboard control loop."""
    if not sys.stdin.isatty():
        raise SystemExit("Keyboard mode requires an interactive terminal (TTY).")

    fd = sys.stdin.fileno()
    try:
        old_settings = termios.tcgetattr(fd)
        tty.setcbreak(fd)
    except termios.error:
        # Some terminal environments (e.g. certain IDE consoles) report TTY
        # but still fail ioctl calls. Fall back to simple line-input mode.
        return line_input_loop(walk_speed, turn_speed)

    print("Controls: W forward | S backward | A left | D right | X/Space stop | Q quit")
    stop_all()

    try:
        while True:
            key = read_key()
            if key is None:
                continue

            k = key.lower()
            if k == "w":
                drive_forward(walk_speed)
            elif k == "s":
                drive_backward(walk_speed)
            elif k == "a":
                turn_left(turn_speed)
            elif k == "d":
                turn_right(turn_speed)
            elif k in {"x", " "}:
                stop_all()
            elif k == "q":
                print("QUIT")
                break
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def line_input_loop(walk_speed: float, turn_speed: float) -> None:
    """Fallback control mode for environments where termios ioctl fails."""
    print("Fallback input mode: type W/S/A/D/X/Q then Enter.")
    stop_all()
    while True:
        try:
            key = input("cmd> ").strip().lower()
        except EOFError:
            break

        if not key:
            continue
        k = key[0]
        if k == "w":
            drive_forward(walk_speed)
        elif k == "s":
            drive_backward(walk_speed)
        elif k == "a":
            turn_left(turn_speed)
        elif k == "d":
            turn_right(turn_speed)
        elif k in {"x", " "}:
            stop_all()
        elif k == "q":
            print("QUIT")
            break


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="2-motor walker control for L298N on Raspberry Pi 5")
    parser.add_argument(
        "--walk-speed",
        type=float,
        default=WALK_SPEED,
        help=f"Walk speed 0.0..1.0 (default: {WALK_SPEED})",
    )
    parser.add_argument(
        "--turn-speed",
        type=float,
        default=TURN_SPEED,
        help=f"Turn speed 0.0..1.0 (default: {TURN_SPEED})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print motor states without writing to GPIO.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    walk_speed = abs(clamp_speed(args.walk_speed))
    turn_speed = abs(clamp_speed(args.turn_speed))

    setup_gpio(dry_run=args.dry_run)

    try:
        keyboard_loop(walk_speed=walk_speed, turn_speed=turn_speed)
    except KeyboardInterrupt:
        print("\nCtrl+C received. Exiting...")
    finally:
        cleanup()


if __name__ == "__main__":
    main()
