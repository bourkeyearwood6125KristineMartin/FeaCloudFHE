// FeaCloudFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FeaCloudFHE is SepoliaConfig {
    struct EncryptedModel {
        uint256 id;
        euint32 encryptedMeshData;
        euint32 encryptedMaterialProperties;
        euint32 encryptedBoundaryConditions;
        uint256 timestamp;
    }
    
    struct AnalysisResult {
        euint32 encryptedStressResults;
        euint32 encryptedDisplacementResults;
        euint32 encryptedTemperatureResults;
    }

    struct DecryptedModel {
        string meshData;
        string materialProperties;
        string boundaryConditions;
        bool isRevealed;
    }

    uint256 public modelCount;
    mapping(uint256 => EncryptedModel) public encryptedModels;
    mapping(uint256 => DecryptedModel) public decryptedModels;
    mapping(uint256 => AnalysisResult) public analysisResults;
    
    mapping(uint256 => uint256) private requestToModelId;
    
    event ModelUploaded(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed modelId);
    event AnalysisCompleted(uint256 indexed modelId);
    event DecryptionRequested(uint256 indexed modelId);
    event ModelDecrypted(uint256 indexed modelId);
    
    modifier onlyOwner(uint256 modelId) {
        _;
    }
    
    function uploadEncryptedModel(
        euint32 encryptedMeshData,
        euint32 encryptedMaterialProperties,
        euint32 encryptedBoundaryConditions
    ) public {
        modelCount += 1;
        uint256 newId = modelCount;
        
        encryptedModels[newId] = EncryptedModel({
            id: newId,
            encryptedMeshData: encryptedMeshData,
            encryptedMaterialProperties: encryptedMaterialProperties,
            encryptedBoundaryConditions: encryptedBoundaryConditions,
            timestamp: block.timestamp
        });
        
        decryptedModels[newId] = DecryptedModel({
            meshData: "",
            materialProperties: "",
            boundaryConditions: "",
            isRevealed: false
        });
        
        emit ModelUploaded(newId, block.timestamp);
    }
    
    function requestModelDecryption(uint256 modelId) public onlyOwner(modelId) {
        EncryptedModel storage model = encryptedModels[modelId];
        require(!decryptedModels[modelId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(model.encryptedMeshData);
        ciphertexts[1] = FHE.toBytes32(model.encryptedMaterialProperties);
        ciphertexts[2] = FHE.toBytes32(model.encryptedBoundaryConditions);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptModel.selector);
        requestToModelId[reqId] = modelId;
        
        emit DecryptionRequested(modelId);
    }
    
    function decryptModel(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 modelId = requestToModelId[requestId];
        require(modelId != 0, "Invalid request");
        
        EncryptedModel storage eModel = encryptedModels[modelId];
        DecryptedModel storage dModel = decryptedModels[modelId];
        require(!dModel.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dModel.meshData = results[0];
        dModel.materialProperties = results[1];
        dModel.boundaryConditions = results[2];
        dModel.isRevealed = true;
        
        emit ModelDecrypted(modelId);
    }
    
    function requestAnalysis(uint256 modelId) public onlyOwner(modelId) {
        require(encryptedModels[modelId].id != 0, "Model not found");
        
        emit AnalysisRequested(modelId);
    }
    
    function submitAnalysisResults(
        uint256 modelId,
        euint32 encryptedStressResults,
        euint32 encryptedDisplacementResults,
        euint32 encryptedTemperatureResults
    ) public {
        analysisResults[modelId] = AnalysisResult({
            encryptedStressResults: encryptedStressResults,
            encryptedDisplacementResults: encryptedDisplacementResults,
            encryptedTemperatureResults: encryptedTemperatureResults
        });
        
        emit AnalysisCompleted(modelId);
    }
    
    function requestResultDecryption(uint256 modelId, uint8 resultType) public onlyOwner(modelId) {
        AnalysisResult storage result = analysisResults[modelId];
        require(FHE.isInitialized(result.encryptedStressResults), "No results available");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        
        if (resultType == 0) {
            ciphertexts[0] = FHE.toBytes32(result.encryptedStressResults);
        } else if (resultType == 1) {
            ciphertexts[0] = FHE.toBytes32(result.encryptedDisplacementResults);
        } else if (resultType == 2) {
            ciphertexts[0] = FHE.toBytes32(result.encryptedTemperatureResults);
        } else {
            revert("Invalid result type");
        }
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptResult.selector);
        requestToModelId[reqId] = modelId * 10 + resultType;
    }
    
    function decryptResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 compositeId = requestToModelId[requestId];
        uint256 modelId = compositeId / 10;
        uint8 resultType = uint8(compositeId % 10);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string memory result = abi.decode(cleartexts, (string));
    }
    
    function getDecryptedModel(uint256 modelId) public view returns (
        string memory meshData,
        string memory materialProperties,
        string memory boundaryConditions,
        bool isRevealed
    ) {
        DecryptedModel storage m = decryptedModels[modelId];
        return (m.meshData, m.materialProperties, m.boundaryConditions, m.isRevealed);
    }
    
    function hasAnalysisResults(uint256 modelId) public view returns (bool) {
        return FHE.isInitialized(analysisResults[modelId].encryptedStressResults);
    }
}