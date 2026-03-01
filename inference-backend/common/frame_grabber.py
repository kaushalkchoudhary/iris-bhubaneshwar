#!/usr/bin/env python3
"""
Generic Frame Grabber
Connects to an RTSP stream, decodes frames, and pushes them to consumer queues.
"""

import cv2
import os
import time
import logging
import threading
from typing import List
from queue import Queue, Full, Empty

logger = logging.getLogger(__name__)



def attempt_connection_and_read(video_source: str, transport: str, buffer_size: int, result_queue: Queue):
    """
    Target function for a thread. Attempts to connect and read the first frame.
    Puts the capture object on the queue if successful, otherwise None.
    """
    cap = None
    try:
        logger.info(f"[{video_source}] Connection thread: RUNNING.")
        # Restore the setting from the working test script
        if "rtsp" in video_source.lower() and transport.lower() == "tcp":
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        else:
            # Explicitly remove the variable if not using TCP to avoid side effects
            if "OPENCV_FFMPEG_CAPTURE_OPTIONS" in os.environ:
                del os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"]

                
        
        logger.info(f"[{video_source}] Connection thread: Calling cv2.VideoCapture...")
        cap = cv2.VideoCapture(video_source, cv2.CAP_FFMPEG)
        logger.info(f"[{video_source}] Connection thread: cv2.VideoCapture call returned.")

        # The critical check: can we actually read from the stream?
        if cap.isOpened():
            logger.info(f"[{video_source}] Connection thread: Stream is open. Reading frame...")
            ret, _ = cap.read()
            logger.info(f"[{video_source}] Connection thread: Frame read attempt returned {ret}.")
            if ret:
                result_queue.put(cap) # Success!
                logger.info(f"[{video_source}] Connection thread: SUCCESS. Capture object sent to parent.")
                return
        
        # If we reach here, connection failed
        if cap:
            cap.release()
        result_queue.put(None)

    except Exception as e:
        logger.error(f"Exception in connection thread for {video_source}: {e}")
        if cap:
            cap.release()
        result_queue.put(None)


class FrameGrabber:
    """
    Connects to a video source, reads frames, and distributes them to one or more queues.
    """
    def __init__(self, name: str, video_source: str, output_queues: List[Queue],
                 rtsp_transport: str = "tcp", buffer_size: int = 10, is_mp4: bool = False,
                 frame_skip: int = 6, resize_width: int = None,
                 raw_output_queues: List[Queue] = None):
        """
        Args:
            name: A unique name for this grabber instance (e.g., camera_id).
            video_source: The URL of the RTSP stream or path to an MP4 file.
            output_queues: A list of queues that receive 1-in-N frames (subject to frame_skip).
            rtsp_transport: RTSP transport protocol ("tcp" or "udp").
            buffer_size: Video capture buffer size.
            is_mp4: Whether the video source is an MP4 file.
            frame_skip: Process 1 out of N frames for output_queues.
            resize_width: Optional width to resize frames (maintains aspect ratio).
            raw_output_queues: Queues that receive EVERY frame with no frame_skip (for raw streaming).
        """
        self.name = name
        self.video_source = video_source
        self.output_queues = output_queues
        self.raw_output_queues = raw_output_queues or []
        self.rtsp_transport = rtsp_transport
        self.buffer_size = buffer_size
        self.is_mp4 = is_mp4
        self.frame_skip = frame_skip
        self.resize_width = resize_width
        self.frame_counter = 0

        self.cap = None
        self.running = False
        self.thread = threading.Thread(target=self._run_loop, daemon=True, name=f"FrameGrabber-{name}")
        
        # Frame statistics
        self.total_frames_read = 0
        self.frames_sent = 0
        self.frames_dropped_skip = 0
        self.frames_dropped_queue = 0
        self.last_stats_time = time.time()
        self.stats_interval = 30.0  # Log stats every 30 seconds
        self.last_warning_times = {} # For rate-limiting warnings

        # Logging setup
        log_dir = "logs"
        os.makedirs(log_dir, exist_ok=True)
        handler = logging.FileHandler(os.path.join(log_dir, f"grabber_{self.name}.log"))
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.WARNING)

    def _should_log_warning(self, key: str, interval: float = 60.0) -> bool:
        """Returns True if a warning for 'key' should be logged (rate-limited)."""
        now = time.time()
        last_time = self.last_warning_times.get(key, 0)
        if now - last_time >= interval:
            self.last_warning_times[key] = now
            return True
        return False

    def _initialize_capture(self) -> bool:
        """Initializes the video capture object with a timeout."""
        logger.info(f"[{self.name}] _initialize_capture called. Starting connection thread...")
        
        result_queue = Queue()
        conn_thread = threading.Thread(
            target=attempt_connection_and_read,
            args=(self.video_source, self.rtsp_transport, self.buffer_size, result_queue),
            name=f"ConnThread-{self.name}"
        )
        conn_thread.daemon = True
        logger.info(f"[{self.name}] Connection thread created. Starting it now...")
        conn_thread.start()
        logger.info(f"[{self.name}] Connection thread started. Waiting on queue for result...")

        try:
            # Wait for the connection attempt to finish, with a timeout.
            self.cap = result_queue.get(timeout=10.0)
            logger.info(f"[{self.name}] Got result from queue. Cap object is {'VALID' if self.cap else 'None'}.")
        except Empty:
            logger.error(f"[{self.name}] Connection to {self.video_source} timed out after 10 seconds.")
            self.cap = None
            return False

        if self.cap:
            logger.info(f"[{self.name}] Successfully connected to {self.video_source}")
            return True
        else:
            logger.error(f"[{self.name}] Failed to open video source: {self.video_source}")
            return False

    def start(self):
        """Starts the frame grabbing thread."""
        logger.info(f"[{self.name}] Starting frame grabber.")
        self.running = True
        self.thread.start()

    def stop(self):
        """Stops the frame grabbing thread."""
        logger.info(f"[{self.name}] Stopping frame grabber.")
        self.running = False
        if self.thread.is_alive():
            self.thread.join()

    def _run_loop(self):
        """The main loop for reading frames and pushing them to queues."""
        logger.info(f"[{self.name}] _run_loop started in thread {threading.current_thread().name}")
        
        while self.running:
            # If not connected, attempt to initialize
            if self.cap is None or not self.cap.isOpened():
                logger.info(f"[{self.name}] Need to initialize capture. cap is {'None' if self.cap is None else 'not opened'}")
                if not self._initialize_capture():
                    logger.error(f"[{self.name}] Initialization failed. Retrying in 10 seconds...")
                    time.sleep(10)
                    continue
            
            # logger.info(f"[{self.name}] Attempting to read frame...")  # Too verbose for production
            ret, frame = self.cap.read()

            if not ret:
                if self._should_log_warning("grab_failed"):
                    logger.warning(f"[{self.name}] Failed to grab frame. Stream might be disconnected (suppressing for 60s).")
                self.cap.release()
                self.cap = None # Force re-initialization in the next loop
                time.sleep(5) # Wait before trying to reconnect
                continue
            
            # Increment frame counter
            self.frame_counter += 1
            self.total_frames_read += 1

            # Optionally resize frame to reduce memory usage
            if self.resize_width and frame.shape[1] > self.resize_width:
                # Calculate new height maintaining aspect ratio
                aspect_ratio = frame.shape[0] / frame.shape[1]
                new_height = int(self.resize_width * aspect_ratio)
                frame = cv2.resize(frame, (self.resize_width, new_height), interpolation=cv2.INTER_AREA)

            frame_data = (self.name, frame)

            # Push EVERY frame to raw_output_queues (no skip — for live streaming)
            for q in self.raw_output_queues:
                try:
                    q.put_nowait(frame_data)
                except Full:
                    pass  # best-effort, drop if consumer is slow

            # Skip frames if needed for inference queues
            if self.frame_counter % self.frame_skip != 0:
                self.frames_dropped_skip += 1
                continue

            # Push the frame to all consumer queues
            for q in self.output_queues:
                try:
                    q.put(frame_data, block=False) # Non-blocking to avoid a slow consumer from stopping the grabber
                    self.frames_sent += 1
                except Full:
                    if self._should_log_warning("queue_full"):
                        logger.warning(f"[{self.name}] Queue for a consumer is full. Frame dropped (suppressing for 60s).")
                    self.frames_dropped_queue += 1

            # Log frame statistics
            current_time = time.time()
            if current_time - self.last_stats_time >= self.stats_interval:
                elapsed = current_time - self.last_stats_time
                input_fps = self.total_frames_read / elapsed if elapsed > 0 else 0
                output_fps = self.frames_sent / elapsed if elapsed > 0 else 0
                
                logger.info(f"[{self.name}] FRAME GRABBER STATS (Last {self.stats_interval}s):")
                logger.info(f"  Frame Skip: 1/{self.frame_skip}")
                logger.info(f"  Input FPS: {input_fps:.1f} | Output FPS: {output_fps:.1f}")
                logger.info(f"  Total read: {self.total_frames_read} | Sent: {self.frames_sent}")
                logger.info(f"  Dropped (skip): {self.frames_dropped_skip} | Dropped (queue): {self.frames_dropped_queue}")
                
                # Reset counters
                self.total_frames_read = 0
                self.frames_sent = 0
                self.frames_dropped_skip = 0
                self.frames_dropped_queue = 0
                self.last_stats_time = current_time

        if self.cap:
            self.cap.release()
        logger.info(f"[{self.name}] Frame grabber loop finished.")

if __name__ == '__main__':
    # Example usage:
    # This shows how the main orchestrator would use this class.
    import sys
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    # 1. Create a queue for a pipeline to consume frames.
    personid_queue = Queue(maxsize=10)

    # 2. Define a video source.
    # Replace with a real RTSP stream or local video file for testing.
    # An example of a public, working RTSP stream.
    video_source = "rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mp4"
    
    # 3. Instantiate and start the grabber.
    grabber = FrameGrabber(
        name="camera_test_public", 
        video_source=video_source,
        output_queues=[personid_queue]
    )
    grabber.start()

    # 4. Simulate a consumer (like the inference worker) pulling from the queue.
    logger.info("Simulating consumer pulling frames from the queue...")
    frames_processed = 0
    start_time = time.time()
    while time.time() - start_time < 5: # Run for 5 seconds
        try:
            cam_id, frame = personid_queue.get(timeout=1)
            if frame is not None:
                frames_processed += 1
                if frames_processed % 10 == 0:
                    logger.info(f"Consumer got frame {frames_processed} from {cam_id} of size {frame.shape}")
        except Empty:
            logger.info("Queue is empty. Consumer is waiting.")
    
    # 5. Stop the grabber and clean up.
    grabber.stop()
    logger.info(f"Consumer processed {frames_processed} frames in 5 seconds.")
    logger.info("Example finished.")
