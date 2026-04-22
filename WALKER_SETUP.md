# Simple Setup Guide (Raspberry Pi 5 + L298N + 2 motors)

This is a very simple guide to get your walker running.

## 1) Wire everything
Use BCM pin numbers.

- ENA -> GPIO18
- IN1 -> GPIO23
- IN2 -> GPIO24
- IN3 -> GPIO27
- IN4 -> GPIO22
- ENB -> GPIO19
- L298N GND -> Pi GND
- Motor 1 -> OUT1/OUT2
- Motor 2 -> OUT3/OUT4
- External battery -> L298N motor power input (not Pi USB power)

Important: Pi GND and L298N GND must be connected together.

## 2) Power on
- Power the Pi normally.
- Power the motor driver from your battery.

## 3) Open Terminal on the Pi
In your project folder, run:

```bash
cd ~/llm-client
```

## 4) Install Python packages
```bash
pip install gpiozero rpi-lgpio
```

## 5) Safe test first (no motor movement)
```bash
python3 scripts/vex_iq_walker.py --dry-run
```

If this prints command output, your script is working.

## 6) Run real control
```bash
python3 scripts/vex_iq_walker.py
```

## 7) Drive keys
- `W` = forward
- `S` = backward
- `A` = left
- `D` = right
- `X` or `Space` = stop
- `Q` = quit

## 8) Adjust speed if needed
```bash
python3 scripts/vex_iq_walker.py --walk-speed 0.55 --turn-speed 0.40
```

## 9) If direction is wrong
Swap motor wires at the L298N outputs for the motor that spins the wrong way.

---
If you want, I can also add a one-command launcher script next.
