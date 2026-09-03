# Cost-Effective Signal Processing Solution for Bat-Call Detection and Hearing

Team Members:

- Theo Xiong (tyxiong2)
- Michael McNally (mm153)
- Liwei Koh (liweitk2)

Sponsored by Dr. Joy O'Keefe and the Human-Wildlife Interactions Lab

# Problem

Reliable heterodyne bat-call detectors are difficult to obtain for under $150 in the United States. Affordable options such as the Magenta Electronics Bat4 (approximately £80) generally require international purchasing and shipping, while comparable devices available in the US, such as the Elekon BATSCANNER (approximately $395), are significantly more expensive. This limits researchers, students, and bat enthusiasts who want an affordable and accessible way to detect and listen to ultrasonic bat calls.

# Solution

Build a portable heterodyne bat detector with a 3D-printed housing that is able to detect ultrasonic bat calls and convert them into frequencies that can be heard by the user. The device will aim to provide similar core functionality to the Magenta Bat4, minus the flashlight, while also using signal processing to recommend a frequency range for the user to tune to.

# Solution Components

## Processing Subsystem

* Processes the microphone signal and performs an FFT to determine the most prominent frequency range being detected.
* Sends the detected frequency range to the display subsystem to recommend where the user should tune the detector.

## Microphone Subsystem

* Uses a directional ultrasonic microphone to pick up bat calls.
* Feeds the captured signal into both the processing and heterodyne subsystems.

## Heterodyne Subsystem

* Passes the microphone signal through filtering and amplification.
* Mixes the signal with a tunable local oscillator signal.
* Shifts the ultrasonic bat call into the human-audible frequency range.
* Filters and amplifies the resulting signal before sending it to the audio output.

## Power Subsystem

* Uses a 4×AA battery pack as the main power source for the device. A voltage regulator is used to provide a stable supply voltage to the microphone, processing, heterodyne, display, and audio subsystems. Basic filtering and an on/off switch are included to help provide clean and controllable power throughout the system.

## Display Subsystem

* Uses an Inland 1602 I2C LCD display module.
* Displays the recommended frequency range determined by the processing subsystem.
* Helps the user determine where to tune the detector.

## Buttons/Dials

* Frequency Tuning Potentiometer: Allows the user to tune the detector through different frequency ranges, with approximately ±5 kHz of fine adjustment around the selected frequency.
* Calibration Button: Allows the user to calibrate the detector and initiate frequency analysis.
* Volume Dial: Controls the volume of the audible output.

# Criterion For Success

* The device should reliably detect the ultrasonic output produced by a bat-call simulator and convert it into an audible signal.
* The device should be practical to construct using readily available and accessible components.
* The device should provide adjustable tuning capabilities, allowing the user to cycle through different frequency ranges to improve detection performance.
* The device should be able to analyze the microphone signal and recommend a frequency range for the user to tune to.

## Stretch Goal

* Collect and analyze enough bat-call data to provide an estimate of the species of bat being detected based on characteristics such as its dominant frequency range.
