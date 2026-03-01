
import torch
import cv2
import numpy as np
import os
import sys

# Add parent directory to path to allow importing config
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from anpr_vcc.config.config import Config

class CTCLabelConverter:
    def __init__(self):
        # Use exact same character set as original model
        self.characters = "0123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"
        self.char_to_idx = {'<BLANK>': 0}
        for i, char in enumerate(self.characters, start=1):
            self.char_to_idx[char] = i
        self.idx_to_char = {idx: char for char, idx in self.char_to_idx.items()}
        self.blank_idx = 0
        self.num_classes = len(self.char_to_idx)
        
    def decode_greedy(self, logits):
        batch_size, seq_len, num_classes = logits.shape
        predictions = np.argmax(logits, axis=2)
        
        results = []
        for batch_idx in range(batch_size):
            pred_seq = predictions[batch_idx]
            decoded = []
            prev_char = None
            
            for char_idx in pred_seq:
                if char_idx != self.blank_idx and char_idx != prev_char:
                    if char_idx in self.idx_to_char:
                        decoded.append(self.idx_to_char[char_idx])
                prev_char = char_idx
            
            results.append(''.join(decoded))
        return results

def correct_o_zero_confusion(text):
    """Smart O/0 correction based on Indian plate format.
    
    Indian format: KA01AB1234
    - Positions 0-1: State code (letters) - keep 'O'
    - Positions 2-3: District code (numbers) - 'O' → '0'
    - Positions 4-5: Series (letters) - keep 'O'
    - Positions 6-9: Number (digits) - 'O' → '0'
    """
    if len(text) < 4:
        # Too short to apply smart correction, just return as-is
        return text
    
    corrected = list(text)
    
    # Positions that should be numeric (district code + number portion)
    # For standard 10-char format: positions 2,3 and 6,7,8,9
    # For 9-char format: positions 2,3 and 5,6,7,8
    numeric_positions = set()
    
    if len(text) >= 10:
        # Standard format: KA01AB1234
        numeric_positions = {2, 3, 6, 7, 8, 9}
    elif len(text) == 9:
        # Compact format: KA01A1234
        numeric_positions = {2, 3, 5, 6, 7, 8}
    else:
        # Fallback: assume last 4 chars are numbers
        numeric_positions = set(range(len(text) - 4, len(text)))
    
    # Apply O → 0 correction only in numeric positions
    for i in numeric_positions:
        if i < len(corrected) and corrected[i] == 'O':
            corrected[i] = '0'
    
    return ''.join(corrected)

class BidirectionalLSTM(torch.nn.Module):
    def __init__(self, input_size, hidden_size, output_size):
        super(BidirectionalLSTM, self).__init__()
        self.rnn = torch.nn.LSTM(input_size, hidden_size, bidirectional=True, batch_first=True)
        self.linear = torch.nn.Linear(hidden_size * 2, output_size)

    def forward(self, x):
        recurrent, _ = self.rnn(x)
        output = self.linear(recurrent)
        return output

class CRNN(torch.nn.Module):
    def __init__(self, num_classes=36, hidden_size=256):
        super(CRNN, self).__init__()
        self.cnn = self._build_custom_cnn()
        cnn_output_channels = 512
        
        self.rnn = torch.nn.Sequential(
            BidirectionalLSTM(cnn_output_channels, hidden_size, hidden_size),
            BidirectionalLSTM(hidden_size, hidden_size, num_classes)
        )

    def _build_custom_cnn(self):
        layers = []
        layers.append(torch.nn.Conv2d(3, 64, kernel_size=3, stride=1, padding=1))
        layers.append(torch.nn.ReLU(inplace=True))
        layers.append(torch.nn.MaxPool2d(2, 2))
        layers.append(torch.nn.Conv2d(64, 128, kernel_size=3, stride=1, padding=1))
        layers.append(torch.nn.ReLU(inplace=True))
        layers.append(torch.nn.MaxPool2d(2, 2))
        layers.append(torch.nn.Conv2d(128, 256, kernel_size=3, stride=1, padding=1))
        layers.append(torch.nn.BatchNorm2d(256))
        layers.append(torch.nn.ReLU(inplace=True))
        layers.append(torch.nn.Conv2d(256, 256, kernel_size=3, stride=1, padding=1))
        layers.append(torch.nn.ReLU(inplace=True))
        layers.append(torch.nn.MaxPool2d((2, 1), (2, 1)))
        layers.append(torch.nn.Conv2d(256, 512, kernel_size=3, stride=1, padding=1))
        layers.append(torch.nn.BatchNorm2d(512))
        layers.append(torch.nn.ReLU(inplace=True))
        layers.append(torch.nn.Conv2d(512, 512, kernel_size=3, stride=1, padding=1))
        layers.append(torch.nn.ReLU(inplace=True))
        layers.append(torch.nn.MaxPool2d((2, 1), (2, 1)))
        layers.append(torch.nn.Conv2d(512, 512, kernel_size=2, stride=1, padding=0))
        layers.append(torch.nn.ReLU(inplace=True))
        return torch.nn.Sequential(*layers)

    def forward(self, x):
        conv_features = self.cnn(x)
        conv_features = torch.mean(conv_features, dim=2)  # Avg pool over height
        conv_features = conv_features.permute(0, 2, 1)    # (B, W, C)
        output = self.rnn(conv_features)
        return output

from collections import deque, Counter

class OCRBuffer:
    """Buffers OCR results for consensus voting."""
    def __init__(self, buffer_size=10):
        self.buffer = deque(maxlen=buffer_size)
        self.best_box = None
        self.best_box_conf = 0.0
    
    def add(self, text, conf, box=None):
        # Relaxed length check from >2 to >1
        # Accept more reads for consensus voting (including partial reads)
        if text and len(text) > 1:
            self.buffer.append((text, conf))
        if box is not None and conf > self.best_box_conf:
            self.best_box = box
            self.best_box_conf = conf
    
    def get_best_text(self):
        if not self.buffer:
            return None, 0.0
        
        # Strategy 1: High Confidence Winner (Quality > Quantity)
        # If we have a single very clear reading, trust it over multiple blurry guesses
        best_single_text = None
        best_single_conf = 0.0
        
        for text, conf in self.buffer:
            if conf > best_single_conf:
                best_single_conf = conf
                best_single_text = text
                
        # If we found a VERY high quality reading, use it directly
        # Increased threshold to 0.90 to prefer consensus for average cases
        if best_single_conf > 0.90:
            return best_single_text, best_single_conf
        
        # Strategy 2: Character-Level Consensus (Robust Correction)
        # Instead of voting on whole strings (which fails if each has 1 wrong char),
        # we align them and vote on EACH CHARACTER position.
        
        texts = [t[0] for t in self.buffer]
        if not texts:
            return best_single_text, best_single_conf

        # Step 2a: Filter by Consensus Length (Remove partial/noisy detections)
        lengths = [len(t) for t in texts]
        most_common_len = Counter(lengths).most_common(1)[0][0]
        valid_texts = [t for t in texts if len(t) == most_common_len]
        
        # If insufficient data for consensus, fall back to best single
        if not valid_texts:
             return best_single_text, best_single_conf

        # Step 2b: Vote on each character position
        consensus_chars = []
        for i in range(most_common_len):
            chars_at_i = [t[i] for t in valid_texts]
            # Get most common char at this position
            most_common_char = Counter(chars_at_i).most_common(1)[0][0]
            consensus_chars.append(most_common_char)
            
        consensus_text = "".join(consensus_chars)
        
        # Step 2c: Calculate CONSENSUS STRENGTH (not average confidence!)
        # OLD METHOD (BROKEN): Average frame confidences
        #   - Systematic errors = high frame conf = high avg = WRONG!
        # NEW METHOD: Measure agreement on consensus result
        #   - How many readings match our consensus?
        
        # Count exact matches to consensus
        exact_matches = sum(1 for t in valid_texts if t == consensus_text)
        total_readings = len(valid_texts)
        
        # Agreement ratio = confidence
        # High agreement = high confidence (regardless of frame conf)
        # Low agreement = low confidence (uncertain consensus)
        agreement_ratio = exact_matches / total_readings if total_readings > 0 else 0.0
        
        # Blend with character-level agreement for more nuance
        # Calculate agreement at each character position
        char_agreements = []
        for i in range(most_common_len):
            chars_at_i = [t[i] for t in valid_texts]
            most_common = Counter(chars_at_i).most_common(1)[0]
            char_agreement = most_common[1] / len(chars_at_i)
            char_agreements.append(char_agreement)
        
        char_level_conf = sum(char_agreements) / len(char_agreements) if char_agreements else 0.0
        
        # Combine string-level and char-level agreement
        # 70% weight on full string match, 30% on character agreement
        consensus_confidence = 0.7 * agreement_ratio + 0.3 * char_level_conf
        
        return consensus_text, consensus_confidence

    def get_best_box(self):
        return self.best_box

class OCRRecognizer:
    def __init__(self):
        self.device = Config.DEVICE
        self.model_path = Config.MODEL_OCR
        self.converter = CTCLabelConverter()
        self.buffers = {}  # {vehicle_id: OCRBuffer}
        self.max_buffers = 100
        
        # Load PyTorch model by default
        self.crnn = CRNN(num_classes=Config.CRNN_CLASSES)
        checkpoint = torch.load(self.model_path, map_location=self.device)
        state_dict = checkpoint.get('model_state_dict', checkpoint)
        self.crnn.load_state_dict(state_dict)
        self.crnn.to(self.device)
        self.crnn.eval()
        print("   ✓ PyTorch CRNN loaded")

    def update_buffer(self, vehicle_id, text, conf, box=None):
        """Add OCR result to buffer for consensus."""
        if len(self.buffers) > self.max_buffers:
            to_remove = list(self.buffers.keys())[:20]
            for vid in to_remove:
                del self.buffers[vid]
        
        if vehicle_id not in self.buffers:
            self.buffers[vehicle_id] = OCRBuffer()
        self.buffers[vehicle_id].add(text, conf, box)
        
    def get_best_text(self, vehicle_id):
        """Get consensus text from buffer."""
        if vehicle_id in self.buffers:
            return self.buffers[vehicle_id].get_best_text()
        return None, 0.0

    def get_best_box(self, vehicle_id):
        """Get best bounding box seen for this vehicle."""
        if vehicle_id in self.buffers:
            return self.buffers[vehicle_id].get_best_box()
        return None

    def recognize_batch(self, plate_crops):
        """
        Recognize text in a list of images.
        Returns: list of (idx, text) tuples
        """
        if not plate_crops:
            return []
        
        return self._recognize_batch_pytorch(plate_crops)

    def _recognize_batch_pytorch(self, plate_crops):
        """PyTorch batch inference (fallback)"""
        tensors = []
        valid_indices = []
        
        for i, crop in enumerate(plate_crops):
            tensor = self._preprocess(crop)
            if tensor is not None:
                tensors.append(tensor)
                valid_indices.append(i)
        
        if not tensors:
            return []
            
        try:
            batch = torch.cat(tensors, dim=0)
            
            with torch.no_grad():
                logits = self.crnn(batch)
                decoded = self.converter.decode_greedy(logits.cpu().numpy())
                
            results = []
            for idx, text in zip(valid_indices, decoded):
                text = correct_o_zero_confusion(text)
                text = self._fix_common_ocr_errors(text)
                text = text.upper().replace(' ', '').replace('-', '')
                if text:
                    results.append((idx, text))
            
            return results
            
        except Exception as e:
            print(f"OCR Inference Error: {e}")
            return []
    
    def _fix_common_ocr_errors(self, text):
        """Fix common OCR character confusions based on Indian plate patterns.
        
        Indian format: KA01AB1234 or KA18EM3778
        - Positions 0-1: State code (2 letters)
        - Positions 2-3: District code (2 numbers) 
        - Positions 4-5: Series (1-2 letters)
        - Last 4: Number (4 digits)
        """
        if len(text) < 6:
            return text
        
        corrected = list(text)
        
        # Fix position 2-3 (district code - should be numbers)
        for i in [2, 3]:
            if i < len(corrected):
                # Common confusions in number positions
                if corrected[i] == 'I':
                    corrected[i] = '1'
                elif corrected[i] == 'O':
                    corrected[i] = '0'
                elif corrected[i] == 'S':
                    corrected[i] = '5'
                elif corrected[i] == 'Z':
                    corrected[i] = '2'
        
        # Fix positions 4-5 (series - should be letters)
        for i in [4, 5]:
            if i < len(corrected):
                # Common confusions in letter positions
                if corrected[i] == 'U':
                    corrected[i] = 'L'  # U rarely appears, usually L
                elif corrected[i] == '1':
                    corrected[i] = 'I'
                elif corrected[i] == '0':
                    corrected[i] = 'O'
                elif corrected[i] == '8':
                    # 8 in series position might be B
                    corrected[i] = 'B'
        
        # Fix last 4 positions (number - should be digits)
        for i in range(len(corrected) - 4, len(corrected)):
            if i >= 0 and i < len(corrected):
                if corrected[i] == 'I':
                    corrected[i] = '1'
                elif corrected[i] == 'O':
                    corrected[i] = '0'
                elif corrected[i] == 'S':
                    corrected[i] = '5'
                elif corrected[i] == 'Z':
                    corrected[i] = '2'
                elif corrected[i] == 'B':
                    corrected[i] = '8'
        
        return ''.join(corrected)

    def _preprocess(self, img):
        """Preprocessing for CRNN OCR model with ImageNet standardization.
        
        CRITICAL: This model was trained with ImageNet normalization.
        Using different normalization will cause incorrect predictions.
        """
        if img is None or img.size == 0:
            return None
        try:
            # Step 1: Resize to model input size (width, height)
            w, h = Config.CRNN_INPUT_SIZE
            resized = cv2.resize(img, (w, h))
            
            # Step 2: Convert BGR to RGB
            rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            
            # Step 3: Normalize to [0, 1]
            norm = rgb.astype(np.float32) / 255.0
            
            # Step 4: ImageNet standardization (CRITICAL for accuracy)
            # Model was trained with these exact values
            mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
            std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
            standardized = (norm - mean) / std
            
            # Convert to PyTorch tensor: (H, W, C) → (C, H, W)
            tensor = torch.from_numpy(standardized).permute(2, 0, 1).unsqueeze(0).to(self.device)
            return tensor
            
        except Exception as e:
            print(f"OCR preprocess error: {e}")
            return None
